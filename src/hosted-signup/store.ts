import type { Pool } from "pg";

import type { EncryptedConnectorKey } from "../shared-channels/store";

/**
 * Durable, resumable state for the one-page "Create a community" flow. Persists
 * the encrypted identity key BEFORE the irreversible Builderlab bind and the
 * encrypted session credential, so a failure after the account exists can be
 * resumed rather than orphaned (see the migration comment). Both secrets are
 * stored ONLY as AES-256-GCM ciphertext — this module handles no plaintext.
 */

export interface ProvisionCustodyRecord {
  bindPubkey: string;
  communityName: string;
  contactEmail: string;
  npub: string;
  secret: EncryptedConnectorKey;
  /** Encrypted Builderlab session credential; null once no longer needed. */
  session: EncryptedConnectorKey | null;
  sessionExpiresAt: string | null;
  wrappingKeyVersion: number;
}

export interface ResumableProvision {
  bindPubkey: string;
  npub: string;
  secret: EncryptedConnectorKey;
  session: EncryptedConnectorKey | null;
  sessionExpiresAt: string | null;
  wrappingKeyVersion: number;
}

/**
 * Upsert a provision row keyed by the identity pubkey. Called (and awaited)
 * BEFORE the bind on a fresh run: after it returns, the key is recoverable from
 * durable storage no matter what fails downstream. Idempotent on resume.
 */
export async function persistProvisionCustody(
  pool: Pool,
  record: ProvisionCustodyRecord,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO hosted_community_provisions (
        community_name,
        contact_email,
        bind_pubkey,
        npub,
        encrypted_secret,
        secret_nonce,
        secret_auth_tag,
        encrypted_session,
        session_nonce,
        session_auth_tag,
        session_expires_at,
        wrapping_key_version,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
      ON CONFLICT (bind_pubkey) DO UPDATE
        SET community_name = EXCLUDED.community_name,
            contact_email = EXCLUDED.contact_email,
            encrypted_session = EXCLUDED.encrypted_session,
            session_nonce = EXCLUDED.session_nonce,
            session_auth_tag = EXCLUDED.session_auth_tag,
            session_expires_at = EXCLUDED.session_expires_at,
            updated_at = now()
    `,
    [
      record.communityName,
      record.contactEmail,
      record.bindPubkey,
      record.npub,
      record.secret.ciphertext,
      record.secret.nonce,
      record.secret.authTag,
      record.session?.ciphertext ?? null,
      record.session?.nonce ?? null,
      record.session?.authTag ?? null,
      record.sessionExpiresAt,
      record.wrappingKeyVersion,
    ],
  );
}

/**
 * Mark a provision created once the community exists. Clears the encrypted
 * session — it is no longer needed, so we don't keep a bearer credential at rest
 * longer than necessary.
 */
export async function markProvisionCreated(
  pool: Pool,
  bindPubkey: string,
  community: { communityId: string; normalizedHost: string },
): Promise<void> {
  await pool.query(
    `
      UPDATE hosted_community_provisions
      SET status = 'created',
          community_id = $2,
          normalized_host = $3,
          encrypted_session = NULL,
          session_nonce = NULL,
          session_auth_tag = NULL,
          session_expires_at = NULL,
          updated_at = now()
      WHERE bind_pubkey = $1
    `,
    [bindPubkey, community.communityId, community.normalizedHost],
  );
}

/**
 * Find a still-resumable provision for a requested name — one that got a key
 * (and maybe a bind) but never reached 'created'. Returns the encrypted custody
 * so the caller can recover the exact key and, when the session has not expired,
 * finish create/list without re-driving signup against a write-once account.
 */
export async function findResumableProvision(
  pool: Pool,
  communityName: string,
): Promise<ResumableProvision | null> {
  const result = await pool.query<{
    bind_pubkey: string;
    npub: string;
    encrypted_secret: Buffer;
    secret_nonce: Buffer;
    secret_auth_tag: Buffer;
    encrypted_session: Buffer | null;
    session_nonce: Buffer | null;
    session_auth_tag: Buffer | null;
    session_expires_at: Date | null;
    wrapping_key_version: number;
  }>(
    `
      SELECT bind_pubkey, npub,
             encrypted_secret, secret_nonce, secret_auth_tag,
             encrypted_session, session_nonce, session_auth_tag,
             session_expires_at, wrapping_key_version
      FROM hosted_community_provisions
      WHERE community_name = $1
        AND status = 'pending'
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [communityName],
  );
  const row = result.rows[0];
  if (!row) return null;

  const session =
    row.encrypted_session && row.session_nonce && row.session_auth_tag
      ? {
          authTag: row.session_auth_tag,
          ciphertext: row.encrypted_session,
          nonce: row.session_nonce,
        }
      : null;

  return {
    bindPubkey: row.bind_pubkey,
    npub: row.npub,
    secret: {
      authTag: row.secret_auth_tag,
      ciphertext: row.encrypted_secret,
      nonce: row.secret_nonce,
    },
    session,
    sessionExpiresAt: row.session_expires_at
      ? row.session_expires_at.toISOString()
      : null,
    wrappingKeyVersion: row.wrapping_key_version,
  };
}
