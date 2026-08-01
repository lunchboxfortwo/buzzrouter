import { createHash, randomBytes } from "node:crypto";

import { npubEncode, nsecEncode } from "nostr-tools/nip19";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Pool } from "pg";

import { ApiError } from "../http/api-error";
import type { WrappingKeyProvider } from "../shared-channels/connector";
import { createFileWrappingKeyProvider } from "../shared-channels/connector";
// Reuse the connector's audited custody primitives verbatim — same threat
// model (host wrapping key, GCM AAD binding), so the highest-risk code has one
// implementation, not a fork.
import {
  decryptConnectorPrivateKey,
  encryptConnectorPrivateKey,
  type EncryptedConnectorKey,
} from "../shared-channels/store";

const SESSION_TOKEN_BYTES = 32;
// Long-lived so a visitor can come back to the same identity from the same
// browser weeks later; it is only a pointer to the identity, never the key.
const SESSION_TTL_MS = 90 * 24 * 60 * 60_000;
const DEFAULT_WRAPPING_KEY_VERSION = 1;

export const IDENTITY_SESSION_COOKIE = "br_identity";

export interface ManagedIdentityRef {
  identityId: string;
  pubkey: string;
}

export interface ManagedIdentityMembership {
  communityId: string | null;
  joinedAt: string;
  relayHost: string;
  role: string | null;
}

export interface ManagedIdentityPublic {
  createdAt: string;
  exportedAt: string | null;
  memberships: ManagedIdentityMembership[];
  npub: string;
  pubkey: string;
}

function configuredWrappingKeyVersion(): number {
  const raw =
    process.env.BUZZROUTER_CONNECTOR_WRAPPING_KEY_VERSION ??
    String(DEFAULT_WRAPPING_KEY_VERSION);
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError(
      "wrapping_key_version_invalid",
      "Connector wrapping-key version is invalid.",
      500,
    );
  }
  return version;
}

function hashSessionToken(token: string): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ApiError(
      "identity_session_invalid",
      "The session is invalid.",
      401,
    );
  }
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a fresh managed identity: a server-side keypair whose secret is
 * sealed at rest with the host wrapping key (the GCM AAD is the pubkey, which
 * is public and unique per identity). The secret is zeroed before returning and
 * never leaves this process in the clear.
 */
export async function createManagedIdentity(
  pool: Pool,
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
): Promise<ManagedIdentityRef> {
  const wrappingKeyVersion = configuredWrappingKeyVersion();
  const privateKey = generateSecretKey();
  const pubkey = getPublicKey(privateKey);
  try {
    const wrappingKey = await wrappingKeys.getKey(wrappingKeyVersion);
    const encrypted = encryptConnectorPrivateKey(
      privateKey,
      wrappingKey,
      pubkey,
    );
    const result = await pool.query<{ id: string }>(
      `
        INSERT INTO managed_identities (
          pubkey,
          encrypted_private_key,
          private_key_nonce,
          private_key_auth_tag,
          wrapping_key_version
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [
        pubkey,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.authTag,
        wrappingKeyVersion,
      ],
    );
    return { identityId: result.rows[0].id, pubkey };
  } finally {
    privateKey.fill(0);
  }
}

/**
 * Mint a durable session bearer token pointing at an identity. Only the sha256
 * of the token is stored; the raw token is returned once for the cookie.
 */
export async function mintIdentitySession(
  pool: Pool,
  identityId: string,
): Promise<{ expiresAt: string; token: string }> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const result = await pool.query<{ expires_at: Date }>(
    `
      INSERT INTO managed_identity_sessions (
        identity_id,
        session_hash,
        expires_at
      )
      VALUES ($1, $2, now() + make_interval(secs => $3))
      RETURNING expires_at
    `,
    [identityId, hashSessionToken(token), Math.floor(SESSION_TTL_MS / 1_000)],
  );
  return { expiresAt: result.rows[0].expires_at.toISOString(), token };
}

/**
 * Resolve a session token to its identity, or throw 401. Touches last_seen so
 * an active session stays live. Fails closed — this credential is what lets a
 * request act as (and export) a managed key.
 */
export async function resolveIdentitySession(
  pool: Pool,
  token: string,
): Promise<ManagedIdentityRef> {
  const result = await pool.query<{ identity_id: string; pubkey: string }>(
    `
      UPDATE managed_identity_sessions AS sessions
      SET last_seen_at = now()
      FROM managed_identities AS identities
      WHERE sessions.session_hash = $1
        AND sessions.expires_at > now()
        AND identities.id = sessions.identity_id
      RETURNING sessions.identity_id, identities.pubkey
    `,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "identity_session_invalid",
      "Your session has expired. Reload to get a fresh managed identity.",
      401,
    );
  }
  return { identityId: row.identity_id, pubkey: row.pubkey };
}

/**
 * Load and decrypt an identity's secret key, run `fn` with it, and zero it
 * afterward no matter what. The plaintext key never escapes this scope — return
 * data derived from it (e.g. a claim result), not the key itself.
 */
export async function withIdentitySecret<T>(
  pool: Pool,
  identityId: string,
  fn: (privateKey: Buffer, pubkey: string) => Promise<T>,
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
): Promise<T> {
  const result = await pool.query<
    EncryptedRow & { pubkey: string; wrapping_key_version: number }
  >(
    `
      SELECT
        pubkey,
        encrypted_private_key,
        private_key_nonce,
        private_key_auth_tag,
        wrapping_key_version
      FROM managed_identities
      WHERE id = $1
    `,
    [identityId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError("identity_not_found", "Managed identity not found.", 404);
  }
  const wrappingKey = await wrappingKeys.getKey(row.wrapping_key_version);
  const privateKey = decryptConnectorPrivateKey(
    toEncrypted(row),
    wrappingKey,
    row.pubkey,
  );
  try {
    return await fn(privateKey, row.pubkey);
  } finally {
    privateKey.fill(0);
  }
}

interface EncryptedRow {
  encrypted_private_key: Buffer;
  private_key_auth_tag: Buffer;
  private_key_nonce: Buffer;
}

function toEncrypted(row: EncryptedRow): EncryptedConnectorKey {
  return {
    authTag: row.private_key_auth_tag,
    ciphertext: row.encrypted_private_key,
    nonce: row.private_key_nonce,
  };
}

/**
 * Reveal the nsec for export. This is the ONLY path that returns key material,
 * and it marks the identity exported so the UI can warn that a copy now lives
 * outside our custody. Returns the nsec derived in-scope; the raw bytes are
 * zeroed immediately after encoding.
 */
export async function exportIdentityNsec(
  pool: Pool,
  identityId: string,
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
): Promise<{ npub: string; nsec: string }> {
  const out = await withIdentitySecret(
    pool,
    identityId,
    async (privateKey, pubkey) => ({
      npub: npubEncode(pubkey),
      // nsecEncode copies into its own bech32 buffer; privateKey is zeroed by
      // withIdentitySecret's finally.
      nsec: nsecEncode(Uint8Array.from(privateKey)),
    }),
    wrappingKeys,
  );
  await pool.query(
    `
      UPDATE managed_identities
      SET exported_at = COALESCE(exported_at, now())
      WHERE id = $1
    `,
    [identityId],
  );
  return out;
}

/** Record (idempotently) that an identity joined a community. */
export async function recordMembership(
  pool: Pool,
  input: {
    communityId: string | null;
    identityId: string;
    relayHost: string;
    role: string | null;
  },
): Promise<void> {
  await pool.query(
    `
      INSERT INTO managed_identity_memberships (
        identity_id,
        relay_host,
        community_id,
        role
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (identity_id, relay_host) DO UPDATE
      SET community_id = COALESCE(
            EXCLUDED.community_id,
            managed_identity_memberships.community_id
          ),
          role = COALESCE(EXCLUDED.role, managed_identity_memberships.role),
          joined_at = managed_identity_memberships.joined_at
    `,
    [input.identityId, input.relayHost, input.communityId, input.role],
  );
}

async function listMemberships(
  pool: Pool,
  identityId: string,
): Promise<ManagedIdentityMembership[]> {
  const result = await pool.query<{
    community_id: string | null;
    joined_at: Date;
    relay_host: string;
    role: string | null;
  }>(
    `
      SELECT relay_host, community_id, role, joined_at
      FROM managed_identity_memberships
      WHERE identity_id = $1
      ORDER BY joined_at DESC
    `,
    [identityId],
  );
  return result.rows.map((row) => ({
    communityId: row.community_id,
    joinedAt: row.joined_at.toISOString(),
    relayHost: row.relay_host,
    role: row.role,
  }));
}

/** Public-safe view of an identity for the UI. Never includes key material. */
export async function getManagedIdentityPublic(
  pool: Pool,
  identityId: string,
): Promise<ManagedIdentityPublic> {
  const result = await pool.query<{
    created_at: Date;
    exported_at: Date | null;
    pubkey: string;
  }>(
    `
      SELECT pubkey, created_at, exported_at
      FROM managed_identities
      WHERE id = $1
    `,
    [identityId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError("identity_not_found", "Managed identity not found.", 404);
  }
  return {
    createdAt: row.created_at.toISOString(),
    exportedAt: row.exported_at ? row.exported_at.toISOString() : null,
    memberships: await listMemberships(pool, identityId),
    npub: npubEncode(row.pubkey),
    pubkey: row.pubkey,
  };
}
