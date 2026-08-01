import { createHash, randomBytes } from "node:crypto";

import type { Pool } from "pg";

import { ApiError } from "../http/api-error";

const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_MS = 30 * 60_000;

export const OWNER_SESSION_HEADER = "x-owner-session";

export interface OwnerSession {
  communityId: string;
  ownerPubkey: string;
}

export interface MintedOwnerSession extends OwnerSession {
  expiresAt: string;
  session: string;
}

function hashSessionToken(token: string): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ApiError("owner_session_invalid", "The session is invalid.", 401);
  }
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a short-lived, community-scoped owner session after a signer-free invite
 * admission. The raw token is returned once and only its hash is stored.
 */
export async function mintOwnerSession(
  pool: Pool,
  input: { communityId: string; ownerPubkey: string },
): Promise<MintedOwnerSession> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const result = await pool.query<{ expires_at: Date }>(
    `
      INSERT INTO connection_owner_sessions (
        community_id,
        owner_pubkey,
        session_hash,
        expires_at
      )
      VALUES ($1, $2, $3, now() + make_interval(secs => $4))
      RETURNING expires_at
    `,
    [
      input.communityId,
      input.ownerPubkey,
      hashSessionToken(token),
      Math.floor(SESSION_TTL_MS / 1_000),
    ],
  );
  return {
    communityId: input.communityId,
    expiresAt: result.rows[0].expires_at.toISOString(),
    ownerPubkey: input.ownerPubkey,
    session: token,
  };
}

/**
 * Resolve a session bearer token to its community + owner, or throw. Failing
 * closed (401) is important: this credential authorizes the signer-free
 * "Connect with the BuzzRouter community" action.
 */
export async function resolveOwnerSession(
  pool: Pool,
  token: string,
): Promise<OwnerSession> {
  const result = await pool.query<{
    community_id: string;
    owner_pubkey: string;
  }>(
    `
      SELECT community_id, owner_pubkey
      FROM connection_owner_sessions
      WHERE session_hash = $1
        AND expires_at > now()
    `,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "owner_session_invalid",
      "The session has expired. Paste your invite link again to continue.",
      401,
    );
  }
  return { communityId: row.community_id, ownerPubkey: row.owner_pubkey };
}
