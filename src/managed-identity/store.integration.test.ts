import { randomBytes } from "node:crypto";

import { decode } from "nostr-tools/nip19";
import { getPublicKey } from "nostr-tools/pure";
import { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ApiError } from "../http/api-error";
import type { WrappingKeyProvider } from "../shared-channels/connector";
import {
  createManagedIdentity,
  exportIdentityNsec,
  getManagedIdentityPublic,
  mintIdentitySession,
  recordMembership,
  resolveIdentitySession,
  withIdentitySecret,
} from "./store";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

// A fixed in-test wrapping key so the suite never touches the real root-owned
// key file. The real custody path is unchanged — we only inject the key source.
const WRAPPING_KEY = randomBytes(32);
const wrappingKeys: WrappingKeyProvider = {
  async getKey() {
    return WRAPPING_KEY;
  },
};

describeDatabase("managed-identity store (integration)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE managed_identity_memberships, managed_identity_sessions, managed_identities CASCADE",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an identity and never stores the secret in plaintext", async () => {
    const ref = await createManagedIdentity(pool, wrappingKeys);
    expect(ref.pubkey).toMatch(/^[0-9a-f]{64}$/);

    // Recover the plaintext through the real decrypt path to compare against
    // what actually sits in Postgres.
    const plaintextHex = await withIdentitySecret(
      pool,
      ref.identityId,
      async (privateKey, pubkey) => {
        expect(getPublicKey(Uint8Array.from(privateKey))).toBe(pubkey);
        expect(pubkey).toBe(ref.pubkey);
        return privateKey.toString("hex");
      },
      wrappingKeys,
    );

    const stored = await pool.query<{
      encrypted_private_key: Buffer;
      private_key_auth_tag: Buffer;
      private_key_nonce: Buffer;
    }>(
      `
        SELECT encrypted_private_key, private_key_nonce, private_key_auth_tag
        FROM managed_identities
        WHERE id = $1
      `,
      [ref.identityId],
    );
    const row = stored.rows[0];
    // The ciphertext must differ from the plaintext, and the GCM parts must be
    // present at the expected lengths.
    expect(row.encrypted_private_key.toString("hex")).not.toBe(plaintextHex);
    expect(row.private_key_nonce.byteLength).toBe(12);
    expect(row.private_key_auth_tag.byteLength).toBe(16);
    // The plaintext bytes must not appear anywhere in the stored row.
    const rowDump = Buffer.concat([
      row.encrypted_private_key,
      row.private_key_nonce,
      row.private_key_auth_tag,
    ]).toString("hex");
    expect(rowDump).not.toContain(plaintextHex);
  });

  it("round-trips the key: two loads decrypt to the same secret", async () => {
    const ref = await createManagedIdentity(pool, wrappingKeys);
    const first = await withIdentitySecret(
      pool,
      ref.identityId,
      async (key) => key.toString("hex"),
      wrappingKeys,
    );
    const second = await withIdentitySecret(
      pool,
      ref.identityId,
      async (key) => key.toString("hex"),
      wrappingKeys,
    );
    expect(first).toBe(second);
    expect(getPublicKey(Uint8Array.from(Buffer.from(first, "hex")))).toBe(
      ref.pubkey,
    );
  });

  it("mints and resolves a durable session; rejects an expired one", async () => {
    const ref = await createManagedIdentity(pool, wrappingKeys);
    const session = await mintIdentitySession(pool, ref.identityId);
    const resolved = await resolveIdentitySession(pool, session.token);
    expect(resolved.identityId).toBe(ref.identityId);
    expect(resolved.pubkey).toBe(ref.pubkey);

    await pool.query(
      "UPDATE managed_identity_sessions SET expires_at = now() - interval '1 second'",
    );
    await expect(
      resolveIdentitySession(pool, session.token),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("exports the nsec exactly on the export path, matching the pubkey, and flags custody", async () => {
    const ref = await createManagedIdentity(pool, wrappingKeys);

    const before = await getManagedIdentityPublic(pool, ref.identityId);
    expect(before.exportedAt).toBeNull();
    // The public view NEVER carries key material.
    expect(JSON.stringify(before)).not.toContain("nsec");

    const exported = await exportIdentityNsec(pool, ref.identityId, wrappingKeys);
    expect(exported.nsec).toMatch(/^nsec1/);
    const decoded = decode(exported.nsec);
    expect(decoded.type).toBe("nsec");
    expect(getPublicKey(decoded.data as Uint8Array)).toBe(ref.pubkey);

    const after = await getManagedIdentityPublic(pool, ref.identityId);
    expect(after.exportedAt).not.toBeNull();

    // A second export keeps the original exported_at (honesty flag is sticky).
    const firstExportedAt = after.exportedAt;
    await exportIdentityNsec(pool, ref.identityId, wrappingKeys);
    const again = await getManagedIdentityPublic(pool, ref.identityId);
    expect(again.exportedAt).toBe(firstExportedAt);
  });

  it("records memberships idempotently and surfaces them in the public view", async () => {
    const ref = await createManagedIdentity(pool, wrappingKeys);
    await recordMembership(pool, {
      communityId: "c-1",
      identityId: ref.identityId,
      relayHost: "relay.example.com",
      role: "member",
    });
    await recordMembership(pool, {
      communityId: "c-1",
      identityId: ref.identityId,
      relayHost: "relay.example.com",
      role: "member",
    });
    const view = await getManagedIdentityPublic(pool, ref.identityId);
    expect(view.memberships).toHaveLength(1);
    expect(view.memberships[0]).toMatchObject({
      communityId: "c-1",
      relayHost: "relay.example.com",
      role: "member",
    });
  });

  it("never logs the secret across create, export, and public-view calls", async () => {
    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(" "));
      });
    }

    const ref = await createManagedIdentity(pool, wrappingKeys);
    const plaintextHex = await withIdentitySecret(
      pool,
      ref.identityId,
      async (key) => key.toString("hex"),
      wrappingKeys,
    );
    const exported = await exportIdentityNsec(pool, ref.identityId, wrappingKeys);
    await getManagedIdentityPublic(pool, ref.identityId);

    const joined = logs.join("\n");
    expect(joined).not.toContain(plaintextHex);
    expect(joined).not.toContain(exported.nsec);
  });
});
