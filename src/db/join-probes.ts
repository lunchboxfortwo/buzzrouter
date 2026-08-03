import type { Pool } from "pg";

import { BUZZ_INVITE_CODE_SQL_RE } from "../directory/invite-code-format";
import type { JoinStatus } from "../directory/joinability";

/**
 * Persistence for the join-probe verdicts that gate the directory's "joinable"
 * claim. One row per candidate (`community_join_probes`), pinned to the exact
 * code that was probed so a rotated invite invalidates the verdict rather than
 * inheriting it. See `migrations/20260801T1200_community_join_probes.sql`.
 */

export interface JoinProbeInput {
  candidateId: string;
  /** The advertised invite code that was probed, or null for a code-less probe. */
  code: string | null;
  status: JoinStatus;
  detail?: string | null;
}

/** A candidate whose claimability is due to be (re)probed. */
export interface JoinProbeTarget {
  candidateId: string;
  host: string;
  code: string;
}

/** The relay + advertised invite code for one candidate, keyed by its id. */
export interface CandidateInviteTarget {
  candidateId: string;
  host: string;
  /** Canonical `wss://host` URL, validated at insert by the origin-only CHECK. */
  canonicalRelayUrl: string;
  code: string;
}

/**
 * Resolves the relay + newest advertised invite code for a candidate, keyed by
 * its id. Returns null when the candidate is unknown or has no invite code.
 *
 * The host and relay URL come straight from our own `community_candidates`
 * record (the URL is constrained to a bare `wss://host` origin at insert), never
 * from caller input — so a receipt/claim built from this target cannot be
 * steered at an attacker-chosen host. Keep it that way: callers pass a candidate
 * id, not a URL.
 */
export async function getCandidateInviteTarget(
  pool: Pool,
  candidateId: string,
): Promise<CandidateInviteTarget | null> {
  const result = await pool.query<{
    host: string;
    canonical_relay_url: string;
    code: string;
  }>(
    `
      SELECT candidates.host AS host,
             candidates.canonical_relay_url AS canonical_relay_url,
             invite.code AS code
      FROM community_candidates AS candidates
      JOIN LATERAL (
        -- Newest REAL code only (a NULL or malformed code fails the match);
        -- keep in sync with directory.ts's join_target pick.
        SELECT source_invite_code AS code
        FROM community_sources
        WHERE candidate_id = candidates.id
          AND source_invite_code ~ '${BUZZ_INVITE_CODE_SQL_RE}'
        ORDER BY source_observed_at DESC
        LIMIT 1
      ) AS invite ON true
      WHERE candidates.id = $1
    `,
    [candidateId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    canonicalRelayUrl: row.canonical_relay_url,
    candidateId,
    code: row.code,
    host: row.host,
  };
}

/** Records (upserts) the latest claimability verdict for a candidate. */
export async function recordJoinProbe(
  pool: Pool,
  input: JoinProbeInput,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO community_join_probes
        (candidate_id, probed_code, status, detail, probed_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (candidate_id) DO UPDATE
        SET probed_code = EXCLUDED.probed_code,
            status = EXCLUDED.status,
            detail = EXCLUDED.detail,
            probed_at = EXCLUDED.probed_at
    `,
    [input.candidateId, input.code, input.status, input.detail ?? null],
  );
}

/**
 * Lists verified Buzz candidates that carry an advertised invite code and whose
 * claimability verdict is missing or STALE (probed before `staleBefore`, or
 * recorded against a since-rotated code). Oldest verdict first — and never
 * probed first — so a bounded batch keeps the whole set fresh over time. This is
 * the decay hook: a `probed_at` older than the caller's window makes a prior
 * verdict eligible for re-probing, so an `open` community that later closes (or
 * whose code expires) stops reading as joinable.
 */
export async function listCandidatesForJoinProbe(
  pool: Pool,
  options: { staleBefore: Date; limit: number },
): Promise<JoinProbeTarget[]> {
  const result = await pool.query<{
    candidate_id: string;
    host: string;
    code: string;
  }>(
    `
      SELECT candidates.id AS candidate_id,
             candidates.host AS host,
             invite.code AS code
      FROM community_candidates AS candidates
      JOIN LATERAL (
        -- Same real-code pick as getCandidateInviteTarget: never spend probe
        -- claims on a malformed code that can only answer invite_invalid.
        SELECT source_invite_code AS code
        FROM community_sources
        WHERE candidate_id = candidates.id
          AND source_invite_code ~ '${BUZZ_INVITE_CODE_SQL_RE}'
        ORDER BY source_observed_at DESC
        LIMIT 1
      ) AS invite ON true
      LEFT JOIN community_join_probes AS probe
        ON probe.candidate_id = candidates.id
      WHERE candidates.state = 'verified_buzz'
        AND (
          probe.candidate_id IS NULL
          OR probe.probed_at < $1
          OR probe.probed_code IS DISTINCT FROM invite.code
        )
      ORDER BY probe.probed_at ASC NULLS FIRST
      LIMIT $2
    `,
    [options.staleBefore, options.limit],
  );
  return result.rows.map((row) => ({
    candidateId: row.candidate_id,
    code: row.code,
    host: row.host,
  }));
}
