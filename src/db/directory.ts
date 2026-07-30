import type { Pool } from "pg";

export const DIRECTORY_SORTS = ["evidence", "recent"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

export interface DirectoryCommunity {
  authRequired: boolean | null;
  candidateId: string;
  canonicalRelayUrl: string;
  categories: string[];
  claimed: boolean;
  description: string | null;
  displayName: string;
  evidenceCount: number;
  joinMode: string | null;
  joinUrl: string | null;
  lastVerifiedAt: string;
  relayHost: string;
  slug: string | null;
  softwareVersion: string | null;
  sourceTypes: string[];
  supportedNips: number[];
  websocketOpenMs: number | null;
}

export interface DirectoryQuery {
  category?: string;
  limit?: number;
  search?: string;
  sort?: DirectorySort;
}

export async function listDirectoryCommunities(
  pool: Pool,
  query: DirectoryQuery = {},
): Promise<DirectoryCommunity[]> {
  const limit = query.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("Directory limit must be between 1 and 200.");
  }

  const search = (query.search ?? "").trim().slice(0, 100);
  const category = normalizeCategory(query.category);
  const sort = query.sort ?? "evidence";
  if (!DIRECTORY_SORTS.includes(sort)) {
    throw new Error("Directory sort is invalid.");
  }

  const orderBy =
    sort === "recent"
      ? "last_verified_at DESC, evidence_count DESC, relay_host"
      : "evidence_count DESC, last_verified_at DESC, relay_host";
  const result = await pool.query<{
    auth_required: boolean | null;
    candidate_id: string;
    canonical_relay_url: string;
    categories: string[];
    claimed: boolean;
    description: string | null;
    display_name: string;
    evidence_count: string;
    join_mode: string | null;
    join_url: string | null;
    last_verified_at: Date;
    relay_host: string;
    slug: string | null;
    software_version: string | null;
    source_types: string[];
    supported_nips: number[];
    ws_open_ms: number | null;
  }>(
    `
      WITH directory AS (
        SELECT
          candidates.id AS candidate_id,
          candidates.host AS relay_host,
          candidates.canonical_relay_url,
          COALESCE(
            CASE
              WHEN communities.visibility = 'public'
                THEN communities.display_name
            END,
            catalog.source_display_name,
            CASE
              WHEN lower(COALESCE(latest.relay_name, '')) NOT IN (
                'buzz',
                'buzz relay'
              )
                THEN latest.relay_name
            END,
            initcap(
              replace(
                split_part(candidates.host, '.', 1),
                '-',
                ' '
              )
            )
          ) AS display_name,
          COALESCE(
            CASE
              WHEN communities.visibility = 'public'
                THEN communities.description
            END,
            catalog.source_description,
            latest.relay_description
          ) AS description,
          COALESCE(
            CASE
              WHEN communities.visibility = 'public'
                THEN communities.categories
            END,
            catalog.source_categories,
            '{}'::text[]
          ) AS categories,
          CASE
            WHEN communities.visibility = 'public'
              AND communities.claim_state IN (
                'admin_verified',
                'provider_verified'
              )
              THEN true
            ELSE false
          END AS claimed,
          CASE
            WHEN communities.visibility = 'public'
              THEN communities.slug
          END AS slug,
          CASE
            WHEN communities.visibility = 'public'
              THEN communities.public_join_mode
          END AS join_mode,
          CASE
            WHEN communities.visibility = 'public'
              THEN communities.public_join_url
          END AS join_url,
          latest.probed_at AS last_verified_at,
          latest.ws_open_ms,
          latest.software_version,
          latest.supported_nips,
          latest.auth_required,
          COALESCE(evidence.evidence_count, 0)::text AS evidence_count,
          COALESCE(evidence.source_types, '{}'::text[]) AS source_types
        FROM community_candidates AS candidates
        JOIN LATERAL (
          SELECT
            probed_at,
            ws_open_ms,
            relay_name,
            relay_description,
            software_version,
            supported_nips,
            auth_required
          FROM probe_snapshots
          WHERE candidate_id = candidates.id
            AND result_code = 'exact_software_and_protocol'
            AND tls_valid = true
          ORDER BY probed_at DESC
          LIMIT 1
        ) AS latest ON true
        LEFT JOIN communities
          ON communities.candidate_id = candidates.id
        LEFT JOIN LATERAL (
          SELECT
            source_display_name,
            source_description,
            source_categories
          FROM community_sources
          WHERE candidate_id = candidates.id
            AND source_type = 'buzzdir'
            AND source_display_name IS NOT NULL
          ORDER BY source_observed_at DESC
          LIMIT 1
        ) AS catalog ON true
        LEFT JOIN LATERAL (
          SELECT
            count(*) AS evidence_count,
            array_agg(
              DISTINCT source_type
              ORDER BY source_type
            ) AS source_types
          FROM community_sources
          WHERE candidate_id = candidates.id
        ) AS evidence ON true
        WHERE candidates.state = 'verified_buzz'
          AND latest.probed_at >= now() - interval '48 hours'
      )
      SELECT *
      FROM directory
      WHERE (
        $1 = ''
        OR display_name ILIKE '%' || $1 || '%'
        OR relay_host ILIKE '%' || $1 || '%'
        OR COALESCE(description, '') ILIKE '%' || $1 || '%'
      )
      AND ($2 = '' OR $2 = ANY(categories))
      ORDER BY ${orderBy}
      LIMIT $3
    `,
    [search, category, limit],
  );

  return result.rows.map((row) => ({
    authRequired: row.auth_required,
    candidateId: row.candidate_id,
    canonicalRelayUrl: row.canonical_relay_url,
    categories: row.categories,
    claimed: row.claimed,
    description: row.description,
    displayName: row.display_name,
    evidenceCount: Number(row.evidence_count),
    joinMode: row.join_mode,
    joinUrl: row.join_url,
    lastVerifiedAt: row.last_verified_at.toISOString(),
    relayHost: row.relay_host,
    slug: row.slug,
    softwareVersion: row.software_version,
    sourceTypes: row.source_types,
    supportedNips: row.supported_nips,
    websocketOpenMs: row.ws_open_ms,
  }));
}

function normalizeCategory(category: string | undefined): string {
  const normalized = (category ?? "").trim().toLowerCase();
  return /^[a-z0-9-]{0,50}$/.test(normalized) ? normalized : "";
}
