import { randomBytes } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabasePool } from "../db/pool";

import { encryptSessionCredential } from "./session-custody";
import {
  findResumableProvision,
  markProvisionCreated,
  persistProvisionCustody,
  type ProvisionCustodyRecord,
} from "./store";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const wrappingKey = Buffer.alloc(32, 9);

// All rows this suite writes share this name prefix, so cleanup is scoped to
// exactly what it owns (per the repo's integration-test convention).
const NAME_PREFIX = "itest-provision-";

function fakeSecret(): ProvisionCustodyRecord["secret"] {
  return {
    authTag: randomBytes(16),
    ciphertext: randomBytes(32),
    nonce: randomBytes(12),
  };
}

describeDatabase("hosted_community_provisions store", () => {
  let pool: Pool;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = createDatabasePool();
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM hosted_community_provisions WHERE community_name LIKE $1",
      [`${NAME_PREFIX}%`],
    );
    await pool.end();
  });

  it("persists custody, finds it resumable, and marks it created", async () => {
    const name = `${NAME_PREFIX}${randomBytes(4).toString("hex")}`;
    const bindPubkey = randomBytes(32).toString("hex");
    const session = encryptSessionCredential("s".repeat(43), wrappingKey, bindPubkey);

    await persistProvisionCustody(pool, {
      bindPubkey,
      communityName: name,
      contactEmail: "owner@example.com",
      npub: "npub1itest",
      secret: fakeSecret(),
      session,
      sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      wrappingKeyVersion: 1,
    });

    // Resumable while pending, with a recoverable encrypted session.
    const resumable = await findResumableProvision(pool, name);
    expect(resumable).not.toBeNull();
    expect(resumable?.bindPubkey).toBe(bindPubkey);
    expect(resumable?.session).not.toBeNull();
    expect(resumable?.secret.ciphertext.byteLength).toBe(32);

    // Marking created clears the session and drops it from the resumable set.
    await markProvisionCreated(pool, bindPubkey, {
      communityId: "community-itest",
      normalizedHost: `${name}.communities.buzz.xyz`,
    });
    expect(await findResumableProvision(pool, name)).toBeNull();

    const row = await pool.query<{ status: string; encrypted_session: Buffer | null }>(
      "SELECT status, encrypted_session FROM hosted_community_provisions WHERE bind_pubkey = $1",
      [bindPubkey],
    );
    expect(row.rows[0].status).toBe("created");
    expect(row.rows[0].encrypted_session).toBeNull();
  });

  it("upsert is idempotent on bind_pubkey", async () => {
    const name = `${NAME_PREFIX}${randomBytes(4).toString("hex")}`;
    const bindPubkey = randomBytes(32).toString("hex");
    const record: ProvisionCustodyRecord = {
      bindPubkey,
      communityName: name,
      contactEmail: "owner@example.com",
      npub: "npub1itest",
      secret: fakeSecret(),
      session: null,
      sessionExpiresAt: null,
      wrappingKeyVersion: 1,
    };
    await persistProvisionCustody(pool, record);
    await persistProvisionCustody(pool, record);

    const count = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM hosted_community_provisions WHERE bind_pubkey = $1",
      [bindPubkey],
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });
});
