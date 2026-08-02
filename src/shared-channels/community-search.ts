import type { Pool } from "pg";

export interface CommunitySearchMatch {
  candidateId: string;
  canonicalRelayUrl: string;
  displayName: string | null;
  host: string;
}

/**
 * Search verified Buzz relays so a cold owner can confirm that BuzzRouter
 * knows their community before they paste an owner/admin invite link.
 */
export async function searchVerifiedCommunities(
  pool: Pool,
  search: string,
  limit = 20,
): Promise<CommunitySearchMatch[]> {
  const trimmed = search.trim().slice(0, 100);
  if (!trimmed) return [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Community search limit must be between 1 and 50.");
  }

  const result = await pool.query<{
    candidate_id: string;
    canonical_relay_url: string;
    display_name: string | null;
    host: string;
  }>(
    `
      SELECT
        candidates.id AS candidate_id,
        candidates.canonical_relay_url,
        candidates.host,
        COALESCE(
          communities.display_name,
          communities.display_name_override,
          catalog.source_display_name
        ) AS display_name
      FROM community_candidates AS candidates
      LEFT JOIN communities
        ON communities.candidate_id = candidates.id
      LEFT JOIN LATERAL (
        SELECT source_display_name
        FROM community_sources
        WHERE candidate_id = candidates.id
          AND source_display_name IS NOT NULL
        ORDER BY source_observed_at DESC
        LIMIT 1
      ) AS catalog ON true
      WHERE candidates.state = 'verified_buzz'
        AND (
          candidates.host ILIKE '%' || $1 || '%'
          OR COALESCE(
            communities.display_name,
            communities.display_name_override,
            catalog.source_display_name,
            ''
          ) ILIKE '%' || $1 || '%'
        )
      ORDER BY candidates.host
      LIMIT $2
    `,
    [trimmed, limit],
  );

  return result.rows.map((row) => ({
    candidateId: row.candidate_id,
    canonicalRelayUrl: row.canonical_relay_url,
    displayName: row.display_name,
    host: row.host,
  }));
}
