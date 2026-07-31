import type { Pool } from "pg";

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
