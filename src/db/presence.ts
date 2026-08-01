import type { Pool } from "pg";

import type { FocusSlug } from "../ranking/focus";
import type { CommunitySummary } from "../presence/summarize";

/**
 * Persistence for the communities the BuzzRouter Agent has joined and the cached
 * directory-facing summary of each (table `presence_communities`, keyed by relay
 * host). Membership rows are written on a successful invite claim; the summary
 * columns are refreshed on a recurring schedule. No identifying material is
 * stored — only the public, deterministic counts plus the paraphrased blurb.
 */

export interface JoinedCommunity {
  relayHost: string;
  relayUrl: string;
  communityId: string | null;
}

export interface UpsertMembershipInput {
  relayHost: string;
  relayUrl: string;
  communityId?: string | null;
}

/**
 * Inserts (or refreshes) a membership row. `joined_at` is set once by the column
 * default and is deliberately never touched on conflict, so it records the first
 * join; `community_id` is only overwritten when a fresh non-null value is given.
 */
export async function upsertMembership(
  pool: Pool,
  input: UpsertMembershipInput,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO presence_communities (relay_host, relay_url, community_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (relay_host) DO UPDATE
        SET relay_url = EXCLUDED.relay_url,
            community_id =
              COALESCE(EXCLUDED.community_id, presence_communities.community_id)
    `,
    [input.relayHost, input.relayUrl, input.communityId ?? null],
  );
}

/** Lists the joined communities the refresh job walks, oldest join first. */
export async function listJoinedCommunities(
  pool: Pool,
): Promise<JoinedCommunity[]> {
  const result = await pool.query<{
    relay_host: string;
    relay_url: string;
    community_id: string | null;
  }>(
    `
      SELECT relay_host, relay_url, community_id
      FROM presence_communities
      ORDER BY joined_at ASC
    `,
  );
  return result.rows.map((row) => ({
    communityId: row.community_id,
    relayHost: row.relay_host,
    relayUrl: row.relay_url,
  }));
}

/**
 * Caches the latest summary for a joined community and stamps
 * `last_summarized_at`. Leaves membership columns (relay_url, community_id,
 * joined_at) untouched.
 */
export async function upsertSummary(
  pool: Pool,
  relayHost: string,
  summary: CommunitySummary,
): Promise<void> {
  await pool.query(
    `
      UPDATE presence_communities
      SET goals = $2,
          recent_projects = $3::jsonb,
          activity_level = $4,
          active_member_count = $5,
          total_member_count = $6,
          message_count = $7,
          channel_count = $8,
          window_days = $9,
          last_summarized_at = now()
      WHERE relay_host = $1
    `,
    [
      relayHost,
      summary.goals,
      JSON.stringify(summary.recentProjects),
      summary.activityLevel,
      summary.activeMemberCount,
      summary.totalMemberCount ?? null,
      summary.messageCount,
      summary.channelCount,
      summary.windowDays,
    ],
  );
}

/**
 * Writes the focus the in-community agent classified from real activity onto the
 * community keyed by `relayHost`, as `focus_source = 'presence'`.
 *
 * Precedence: this overwrites only rows the machine set (NULL, the hostname
 * heuristic's `'classified'`, or a prior `'presence'`) — a human's `'operator'`
 * / `'confirmed'` focus is never touched. The heuristic classifier, in turn,
 * only writes over NULL/`'classified'` (see classify-focus-job), so it never
 * clobbers this activity-based value. Ladder: operator/confirmed > presence >
 * classified > null.
 *
 * The `communities` row may not exist yet (unclaimed candidates have none), so
 * this INSERTs from the candidate matched by host and upserts on the unique
 * `candidate_id`. An unknown host simply matches no candidate and writes nothing.
 */
export async function recordPresenceFocus(
  pool: Pool,
  relayHost: string,
  focus: FocusSlug,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO communities (candidate_id, focus, focus_source)
      SELECT id, $2, 'presence'
      FROM community_candidates
      WHERE host = $1
      ON CONFLICT (candidate_id) DO UPDATE
        SET focus = EXCLUDED.focus,
            focus_source = 'presence',
            updated_at = now()
        WHERE communities.focus_source IS NULL
          OR communities.focus_source IN ('classified', 'presence')
    `,
    [relayHost, focus],
  );
}

export interface RecordInviteCandidateInput {
  /** Bare relay host the harvested invite is FOR (already a joined community). */
  relayHost: string;
  /** The harvested invite code. */
  code: string;
  /** Relay host of the community whose channel the invite was seen in. */
  sourceRelayHost?: string | null;
}

/**
 * Records a fresh invite code harvested for a community the agent is already in,
 * as a candidate for a future freshness swap (which is deliberately NOT done
 * here — see `harvestInvites`). Idempotent on `(relay_host, code)`: a repeat
 * harvest only bumps `seen_at` and refreshes the source, never duplicates.
 */
export async function recordInviteCandidate(
  pool: Pool,
  input: RecordInviteCandidateInput,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO harvested_invite_candidates
        (relay_host, code, source_relay_host)
      VALUES ($1, $2, $3)
      ON CONFLICT (relay_host, code) DO UPDATE
        SET seen_at = now(),
            source_relay_host =
              COALESCE(EXCLUDED.source_relay_host,
                       harvested_invite_candidates.source_relay_host)
    `,
    [input.relayHost, input.code, input.sourceRelayHost ?? null],
  );
}

export interface DirectoryInvite {
  /** `community_candidates.id` whose source rows carry the directory invite. */
  candidateId: string;
  /** The invite code the directory currently serves for this community. */
  code: string;
}

/**
 * The invite code the public directory currently serves for a community,
 * resolved by relay host. Joins `community_sources.source_invite_code` to its
 * `community_candidates` row on `canonical_relay_url = 'wss://'||relayHost` and
 * returns the newest non-null code (with its candidate id), or null when the
 * directory has no invite for that host to keep fresh.
 */
export async function getDirectoryInvite(
  pool: Pool,
  relayHost: string,
): Promise<DirectoryInvite | null> {
  const result = await pool.query<{ candidate_id: string; code: string }>(
    `
      SELECT cs.candidate_id, cs.source_invite_code AS code
      FROM community_sources cs
      JOIN community_candidates cc ON cc.id = cs.candidate_id
      WHERE cc.canonical_relay_url = $1
        AND cs.source_invite_code IS NOT NULL
      ORDER BY cs.last_seen_at DESC
      LIMIT 1
    `,
    [`wss://${relayHost}`],
  );
  const row = result.rows[0];
  return row ? { candidateId: row.candidate_id, code: row.code } : null;
}

/**
 * Lists the harvested fresh-invite candidates for a community, newest `seen_at`
 * first, so the freshness swap can probe them in recency order.
 */
export async function listInviteCandidates(
  pool: Pool,
  relayHost: string,
): Promise<{ code: string }[]> {
  const result = await pool.query<{ code: string }>(
    `
      SELECT code
      FROM harvested_invite_candidates
      WHERE relay_host = $1
      ORDER BY seen_at DESC
    `,
    [relayHost],
  );
  return result.rows.map((row) => ({ code: row.code }));
}

/**
 * Swaps the directory's stale invite for a fresh one by updating
 * `source_invite_code` on every source row of the candidate. The code lives
 * only in `source_invite_code`; it is never written to `source_locator` (the
 * `community_sources_no_invites` CHECK forbids a code there).
 */
export async function replaceDirectoryInvite(
  pool: Pool,
  candidateId: string,
  newCode: string,
): Promise<void> {
  await pool.query(
    `
      UPDATE community_sources
      SET source_invite_code = $2,
          last_seen_at = now()
      WHERE candidate_id = $1
    `,
    [candidateId, newCode],
  );
}

/**
 * Clears a harvested candidate once it has been consumed (swapped into the
 * directory) so it is not re-probed on the next pass.
 */
export async function deleteInviteCandidate(
  pool: Pool,
  relayHost: string,
  code: string,
): Promise<void> {
  await pool.query(
    `
      DELETE FROM harvested_invite_candidates
      WHERE relay_host = $1 AND code = $2
    `,
    [relayHost, code],
  );
}

export interface StoredCommunitySummary {
  goals: string;
  recentProjects: string[];
  activityLevel: string;
  activeMemberCount: number;
  totalMemberCount: number | null;
  messageCount: number;
  channelCount: number;
  windowDays: number;
  lastSummarizedAt: string;
}

/**
 * Reads the cached summary for a community by relay host, or null when the
 * agent has joined but no summary has been computed yet (so the profile page
 * can omit the section rather than render a half-empty one).
 */
export async function getCommunitySummary(
  pool: Pool,
  relayHost: string,
): Promise<StoredCommunitySummary | null> {
  const result = await pool.query<{
    goals: string | null;
    recent_projects: unknown;
    activity_level: string | null;
    active_member_count: number | null;
    total_member_count: number | null;
    message_count: number | null;
    channel_count: number | null;
    window_days: number | null;
    last_summarized_at: Date | string;
  }>(
    `
      SELECT goals, recent_projects, activity_level, active_member_count,
             total_member_count, message_count, channel_count, window_days,
             last_summarized_at
      FROM presence_communities
      WHERE relay_host = $1 AND last_summarized_at IS NOT NULL
    `,
    [relayHost],
  );
  const row = result.rows[0];
  if (!row || row.goals === null) return null;
  return {
    activeMemberCount: row.active_member_count ?? 0,
    activityLevel: row.activity_level ?? "active",
    channelCount: row.channel_count ?? 0,
    goals: row.goals,
    lastSummarizedAt:
      row.last_summarized_at instanceof Date
        ? row.last_summarized_at.toISOString()
        : String(row.last_summarized_at),
    messageCount: row.message_count ?? 0,
    recentProjects: Array.isArray(row.recent_projects)
      ? (row.recent_projects as string[])
      : [],
    totalMemberCount: row.total_member_count,
    windowDays: row.window_days ?? 7,
  };
}
