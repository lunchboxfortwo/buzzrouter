import { isIP } from "node:net";

import type { Pool } from "pg";

import { ClaimError } from "./errors";
import type {
  ClaimMethod,
  ListingMetadataInput,
} from "./validation";

export interface ClaimableCandidate {
  canonicalRelayUrl: string;
  candidateId: string;
  host: string;
}

export interface ClaimChallengeRecord extends ClaimableCandidate {
  attempts: number;
  challengeId: string;
  claimantPubkey: string;
  expiresAt: string;
  method: ClaimMethod;
  tokenHash: string;
}

export interface ClaimWorkspace {
  canonicalRelayUrl: string;
  categories: string[];
  claimState: string;
  description: string | null;
  displayName: string | null;
  host: string;
  id: string;
  joinMode: string;
  joinUrl: string | null;
  openToSharedChannels: boolean;
  ownerPubkey: string | null;
  slug: string | null;
  state: string;
  visibility: string;
}

export interface PublicCommunity {
  canonicalRelayUrl: string;
  categories: string[];
  claimState: string;
  description: string;
  displayName: string;
  joinMode: string;
  joinUrl: string | null;
  lastVerifiedAt: string;
  slug: string;
}

export async function createClaimChallenge(
  pool: Pool,
  candidateId: string,
  claimantPubkey: string,
  method: ClaimMethod,
  tokenHash: string,
): Promise<ClaimChallengeRecord> {
  const candidate = await getClaimableCandidate(pool, candidateId);
  assertMethodForHost(method, candidate.host);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        SELECT pg_advisory_xact_lock(
          hashtextextended($1 || ':' || $2, 0)
        )
      `,
      [candidateId, claimantPubkey],
    );
    await client.query(
      `
        UPDATE claim_challenges
        SET status = 'expired',
            updated_at = now()
        WHERE candidate_id = $1
          AND claimant_pubkey = $2
          AND status = 'pending'
      `,
      [candidateId, claimantPubkey],
    );
    const result = await client.query<{
      attempts: number;
      expires_at: Date;
      id: string;
    }>(
      `
        INSERT INTO claim_challenges (
          candidate_id,
          claimant_pubkey,
          method,
          token_hash,
          expires_at
        )
        VALUES ($1, $2, $3, $4, now() + interval '15 minutes')
        RETURNING id, attempts, expires_at
      `,
      [candidateId, claimantPubkey, method, tokenHash],
    );
    await client.query("COMMIT");
    const row = result.rows[0];

    return {
      ...candidate,
      attempts: row.attempts,
      challengeId: row.id,
      claimantPubkey,
      expiresAt: row.expires_at.toISOString(),
      method,
      tokenHash,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function beginChallengeAttempt(
  pool: Pool,
  challengeId: string,
  claimantPubkey: string,
): Promise<ClaimChallengeRecord> {
  const result = await pool.query<{
    attempts: number;
    candidate_id: string;
    canonical_relay_url: string;
    claimant_pubkey: string;
    expires_at: Date;
    host: string;
    id: string;
    method: ClaimMethod;
    token_hash: string;
  }>(
    `
      UPDATE claim_challenges AS challenges
      SET attempts = attempts + 1,
          updated_at = now()
      FROM community_candidates AS candidates
      WHERE challenges.id = $1
        AND challenges.claimant_pubkey = $2
        AND challenges.candidate_id = candidates.id
        AND challenges.status = 'pending'
        AND challenges.expires_at > now()
        AND challenges.attempts < 10
        AND candidates.state = 'verified_buzz'
        AND EXISTS (
          SELECT 1
          FROM probe_snapshots
          WHERE candidate_id = candidates.id
            AND result_code = 'exact_software_and_protocol'
            AND tls_valid = true
            AND probed_at >= now() - interval '48 hours'
        )
      RETURNING
        challenges.id,
        challenges.candidate_id,
        challenges.claimant_pubkey,
        challenges.method,
        challenges.token_hash,
        challenges.attempts,
        challenges.expires_at,
        candidates.canonical_relay_url,
        candidates.host
    `,
    [challengeId, claimantPubkey],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ClaimError(
      "challenge_not_found",
      "Claim challenge is unavailable.",
      404,
    );
  }

  return {
    attempts: row.attempts,
    canonicalRelayUrl: row.canonical_relay_url,
    candidateId: row.candidate_id,
    challengeId: row.id,
    claimantPubkey: row.claimant_pubkey,
    expiresAt: row.expires_at.toISOString(),
    host: row.host,
    method: row.method,
    tokenHash: row.token_hash,
  };
}

export async function failChallengeAttempt(
  pool: Pool,
  challengeId: string,
  attempts: number,
): Promise<void> {
  if (attempts < 10) {
    return;
  }

  await pool.query(
    `
      UPDATE claim_challenges
      SET status = 'failed',
          updated_at = now()
      WHERE id = $1
        AND status = 'pending'
    `,
    [challengeId],
  );
}

export async function completeClaimChallenge(
  pool: Pool,
  challenge: ClaimChallengeRecord,
): Promise<"verified" | "disputed"> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const completed = await client.query<{ id: string }>(
      `
        UPDATE claim_challenges
        SET status = 'verified',
            verified_at = now(),
            updated_at = now()
        WHERE id = $1
          AND status = 'pending'
          AND expires_at > now()
        RETURNING id
      `,
      [challenge.challengeId],
    );
    if (!completed.rows[0]) {
      throw new ClaimError(
        "challenge_expired",
        "Claim challenge is no longer pending.",
        409,
      );
    }

    await client.query(
      `
        INSERT INTO communities (candidate_id)
        VALUES ($1)
        ON CONFLICT (candidate_id) DO NOTHING
      `,
      [challenge.candidateId],
    );
    const existing = await client.query<{
      claim_state: string;
      owner_pubkey: string | null;
    }>(
      `
        SELECT owner_pubkey, claim_state
        FROM communities
        WHERE candidate_id = $1
        FOR UPDATE
      `,
      [challenge.candidateId],
    );
    const owner = existing.rows[0]?.owner_pubkey ?? null;
    const status =
      owner === null || owner === challenge.claimantPubkey
        ? "verified"
        : "disputed";

    await client.query(
      `
        INSERT INTO community_claims (
          candidate_id,
          claimant_pubkey,
          method,
          status,
          challenge_id,
          proof_summary,
          verified_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
      `,
      [
        challenge.candidateId,
        challenge.claimantPubkey,
        challenge.method,
        status,
        challenge.challengeId,
        JSON.stringify({ method: challenge.method }),
      ],
    );

    if (status === "verified") {
      await client.query(
        `
          INSERT INTO communities (
            candidate_id,
            claim_state,
            owner_pubkey
          )
          VALUES ($1, 'admin_verified', $2)
          ON CONFLICT (candidate_id) DO UPDATE
            SET claim_state = 'admin_verified',
                owner_pubkey = EXCLUDED.owner_pubkey,
                updated_at = now()
        `,
        [challenge.candidateId, challenge.claimantPubkey],
      );
    } else {
      await client.query(
        `
          UPDATE communities
          SET claim_state = 'disputed',
              visibility = 'internal',
              updated_at = now()
          WHERE candidate_id = $1
        `,
        [challenge.candidateId],
      );
    }

    await client.query("COMMIT");
    return status;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateListingMetadata(
  pool: Pool,
  candidateId: string,
  ownerPubkey: string,
  metadata: ListingMetadataInput,
): Promise<{ slug: string; visibility: string }> {
  if (metadata.visibility === "public") {
    await assertFreshVerifiedCandidate(pool, candidateId);
  }

  try {
    const result = await pool.query<{ slug: string; visibility: string }>(
      `
        UPDATE communities
        SET slug = $3,
            visibility = $4,
            display_name = $5,
            description = $6,
            categories = $7,
            public_join_mode = $8,
            public_join_url = $9,
            open_to_shared_channels = $10,
            listed_at = CASE
              WHEN $4 = 'public' THEN COALESCE(listed_at, now())
              ELSE listed_at
            END,
            updated_at = now()
        WHERE candidate_id = $1
          AND owner_pubkey = $2
          AND claim_state IN ('admin_verified', 'provider_verified')
        RETURNING slug, visibility
      `,
      [
        candidateId,
        ownerPubkey,
        metadata.slug,
        metadata.visibility,
        metadata.displayName,
        metadata.description,
        metadata.categories,
        metadata.joinMode,
        metadata.joinUrl,
        metadata.openToSharedChannels,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ClaimError(
        "claim_conflict",
        "Verified community ownership is required.",
        403,
      );
    }

    return row;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new ClaimError(
        "claim_conflict",
        "Listing slug is already in use.",
        409,
      );
    }
    throw error;
  }
}

export async function getClaimWorkspace(
  pool: Pool,
  candidateId: string,
): Promise<ClaimWorkspace | null> {
  const result = await pool.query<{
    canonical_relay_url: string;
    categories: string[] | null;
    claim_state: string | null;
    description: string | null;
    display_name: string | null;
    host: string;
    id: string;
    open_to_shared_channels: boolean | null;
    public_join_mode: string | null;
    public_join_url: string | null;
    owner_pubkey: string | null;
    slug: string | null;
    state: string;
    visibility: string | null;
  }>(
    `
      SELECT
        candidates.id,
        candidates.canonical_relay_url,
        candidates.host,
        candidates.state,
        communities.claim_state,
        communities.owner_pubkey,
        communities.display_name,
        communities.description,
        communities.categories,
        communities.slug,
        communities.visibility,
        communities.public_join_mode,
        communities.public_join_url,
        communities.open_to_shared_channels
      FROM community_candidates AS candidates
      LEFT JOIN communities
        ON communities.candidate_id = candidates.id
      WHERE candidates.id = $1
        AND candidates.state = 'verified_buzz'
    `,
    [candidateId],
  );
  const row = result.rows[0];

  return row
    ? {
        canonicalRelayUrl: row.canonical_relay_url,
        categories: row.categories ?? [],
        claimState: row.claim_state ?? "unclaimed",
        description: row.description,
        displayName: row.display_name,
        host: row.host,
        id: row.id,
        joinMode: row.public_join_mode ?? "invite_required",
        joinUrl: row.public_join_url,
        openToSharedChannels: row.open_to_shared_channels ?? false,
        ownerPubkey: row.owner_pubkey,
        slug: row.slug,
        state: row.state,
        visibility: row.visibility ?? "internal",
      }
    : null;
}

export async function getPublicCommunity(
  pool: Pool,
  slug: string,
): Promise<PublicCommunity | null> {
  const result = await pool.query<{
    canonical_relay_url: string;
    categories: string[];
    claim_state: string;
    description: string;
    display_name: string;
    last_verified_at: Date;
    public_join_mode: string;
    public_join_url: string | null;
    slug: string;
  }>(
    `
      SELECT
        candidates.canonical_relay_url,
        communities.slug,
        communities.claim_state,
        communities.display_name,
        communities.description,
        communities.categories,
        communities.public_join_mode,
        communities.public_join_url,
        latest.probed_at AS last_verified_at
      FROM communities
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      JOIN LATERAL (
        SELECT probed_at
        FROM probe_snapshots
        WHERE candidate_id = candidates.id
          AND result_code = 'exact_software_and_protocol'
          AND tls_valid = true
        ORDER BY probed_at DESC
        LIMIT 1
      ) AS latest ON true
      WHERE communities.slug = $1
        AND communities.visibility = 'public'
        AND communities.claim_state IN ('admin_verified', 'provider_verified')
        AND candidates.state = 'verified_buzz'
        AND latest.probed_at >= now() - interval '48 hours'
    `,
    [slug],
  );
  const row = result.rows[0];

  return row
    ? {
        canonicalRelayUrl: row.canonical_relay_url,
        categories: row.categories,
        claimState: row.claim_state,
        description: row.description,
        displayName: row.display_name,
        joinMode: row.public_join_mode,
        joinUrl: row.public_join_url,
        lastVerifiedAt: row.last_verified_at.toISOString(),
        slug: row.slug,
      }
    : null;
}

export async function isChallengeTokenValid(
  pool: Pool,
  challengeId: string,
  tokenHash: string,
): Promise<boolean> {
  const result = await pool.query<{ valid: boolean }>(
    `
      SELECT true AS valid
      FROM claim_challenges
      WHERE id = $1
        AND token_hash = $2
        AND status = 'pending'
        AND expires_at > now()
    `,
    [challengeId, tokenHash],
  );
  return result.rows[0]?.valid === true;
}

async function getClaimableCandidate(
  pool: Pool,
  candidateId: string,
): Promise<ClaimableCandidate> {
  await assertFreshVerifiedCandidate(pool, candidateId);
  const result = await pool.query<{
    canonical_relay_url: string;
    host: string;
    id: string;
  }>(
    `
      SELECT id, canonical_relay_url, host
      FROM community_candidates
      WHERE id = $1
        AND state = 'verified_buzz'
    `,
    [candidateId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ClaimError(
      "candidate_not_found",
      "Verified candidate was not found.",
      404,
    );
  }

  return {
    canonicalRelayUrl: row.canonical_relay_url,
    candidateId: row.id,
    host: row.host,
  };
}

async function assertFreshVerifiedCandidate(
  pool: Pool,
  candidateId: string,
): Promise<void> {
  const result = await pool.query<{ verified: boolean }>(
    `
      SELECT true AS verified
      FROM community_candidates AS candidates
      WHERE candidates.id = $1
        AND candidates.state = 'verified_buzz'
        AND EXISTS (
          SELECT 1
          FROM probe_snapshots
          WHERE candidate_id = candidates.id
            AND result_code = 'exact_software_and_protocol'
            AND tls_valid = true
            AND probed_at >= now() - interval '48 hours'
        )
    `,
    [candidateId],
  );
  if (!result.rows[0]?.verified) {
    throw new ClaimError(
      "candidate_not_verified",
      "Candidate requires a recent successful Buzz verification.",
      409,
    );
  }
}

function assertMethodForHost(method: ClaimMethod, host: string): void {
  if (isIP(host) !== 0) {
    throw new ClaimError(
      "invalid_input",
      "IP-literal relays cannot use domain control proofs.",
    );
  }

  const isHosted = host.endsWith(".communities.buzz.xyz");
  if (
    (isHosted && method !== "hosted_icon") ||
    (!isHosted && method === "hosted_icon")
  ) {
    throw new ClaimError(
      "invalid_input",
      "Claim method is not available for this relay host.",
    );
  }
}
