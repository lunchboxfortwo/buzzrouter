import type { Pool } from "pg";

export const DIRECTORY_SORTS = ["evidence", "recent", "reliable", "new"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

export interface DirectoryCommunity {
  adoptionPubkeys: number;
  adoptionRepos: number;
  authRequired: boolean | null;
  corroborationSources: number;
  evidenceSufficient: boolean;
  firstSeenAt: string;
  focus: string | null;
  metadataChangedAt: string | null;
  probesSuccessful: number;
  probesTotal: number;
  reliabilityScore: number;
  candidateId: string;
  canonicalRelayUrl: string;
  categories: string[];
  claimed: boolean;
  description: string | null;
  displayName: string;
  evidenceCount: number;
  iconUrl: string | null;
  publicUrl: string | null;
  inviteCode: string | null;
  joinMode: string | null;
  joinUrl: string | null;
  lastVerifiedAt: string;
  openToSharedChannels: boolean;
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

  let orderBy = "evidence_count DESC, last_verified_at DESC, relay_host";
  if (sort === "recent") {
    orderBy = "last_verified_at DESC, evidence_count DESC, relay_host";
  } else if (sort === "reliable") {
    orderBy =
      "evidence_sufficient DESC, reliability_score DESC, last_verified_at DESC, relay_host";
  } else if (sort === "new") {
    orderBy = "first_seen_at DESC, relay_host";
  }
  const result = await pool.query<{
    adoption_pubkeys: number | null;
    adoption_repos: number | null;
    auth_required: boolean | null;
    corroboration_sources: number | null;
    display_name_override: string | null;
    evidence_sufficient: boolean | null;
    first_seen_at: Date;
    focus: string | null;
    metadata_changed_at: Date | null;
    probes_successful: number | null;
    probes_total: number | null;
    reliability_score: string | null;
    candidate_id: string;
    canonical_relay_url: string;
    categories: string[];
    claimed: boolean;
    description: string | null;
    display_name: string;
    evidence_count: string;
    has_icon: boolean;
    public_url: string | null;
    invite_code: string | null;
    join_mode: string | null;
    join_url: string | null;
    last_verified_at: Date;
    open_to_shared_channels: boolean;
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
            communities.display_name_override,
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
          COALESCE(
            CASE
              WHEN communities.visibility = 'public'
                THEN communities.open_to_shared_channels
            END,
            false
          ) AS open_to_shared_channels,
          latest.probed_at AS last_verified_at,
          latest.ws_open_ms,
          latest.software_version,
          latest.supported_nips,
          latest.auth_required,
          COALESCE(evidence.evidence_count, 0)::text AS evidence_count,
          COALESCE(evidence.source_types, '{}'::text[]) AS source_types,
          icons.candidate_id IS NOT NULL AS has_icon,
          join_target.public_url,
          join_target.invite_code,
          candidates.first_seen_at,
          communities.focus,
          communities.display_name_override,
          COALESCE(metrics.reliability_score, 0)::text AS reliability_score,
          COALESCE(metrics.adoption_pubkeys, 0) AS adoption_pubkeys,
          COALESCE(metrics.adoption_repos, 0) AS adoption_repos,
          COALESCE(metrics.corroboration_sources, 0) AS corroboration_sources,
          COALESCE(metrics.probes_total, 0) AS probes_total,
          COALESCE(metrics.probes_successful, 0) AS probes_successful,
          metrics.metadata_changed_at,
          COALESCE(metrics.evidence_sufficient, false) AS evidence_sufficient
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
            source_categories,
            source_public_url,
            source_invite_code
          FROM community_sources
          WHERE candidate_id = candidates.id
            AND source_type = 'buzzdir'
            AND source_display_name IS NOT NULL
          ORDER BY source_observed_at DESC
          LIMIT 1
        ) AS catalog ON true
        LEFT JOIN LATERAL (
          SELECT
            (
              SELECT source_invite_code
              FROM community_sources
              WHERE candidate_id = candidates.id
                AND source_invite_code IS NOT NULL
              ORDER BY source_observed_at DESC
              LIMIT 1
            ) AS invite_code,
            (
              SELECT source_public_url
              FROM community_sources
              WHERE candidate_id = candidates.id
                AND source_public_url IS NOT NULL
              ORDER BY source_observed_at DESC
              LIMIT 1
            ) AS public_url
        ) AS join_target ON true
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
        LEFT JOIN community_icons AS icons
          ON icons.candidate_id = candidates.id
        LEFT JOIN community_reliability_metrics AS metrics
          ON metrics.candidate_id = candidates.id
        WHERE candidates.state = 'verified_buzz'
          AND latest.probed_at >= now() - interval '7 days'
      )
      SELECT *
      FROM directory
      WHERE (
        $1 = ''
        OR display_name ILIKE '%' || $1 || '%'
        OR COALESCE(description, '') ILIKE '%' || $1 || '%'
        OR EXISTS (
          SELECT 1
          FROM unnest(categories) AS category_tag
          WHERE category_tag ILIKE '%' || $1 || '%'
        )
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
    adoptionPubkeys: Number(row.adoption_pubkeys ?? 0),
    adoptionRepos: Number(row.adoption_repos ?? 0),
    corroborationSources: Number(row.corroboration_sources ?? 0),
    evidenceSufficient: row.evidence_sufficient ?? false,
    firstSeenAt: row.first_seen_at.toISOString(),
    focus: row.focus,
    metadataChangedAt: row.metadata_changed_at
      ? row.metadata_changed_at.toISOString()
      : null,
    probesSuccessful: Number(row.probes_successful ?? 0),
    probesTotal: Number(row.probes_total ?? 0),
    reliabilityScore: Number(row.reliability_score ?? 0),
    publicUrl: row.public_url,
    inviteCode: row.invite_code,
    iconUrl: row.has_icon
      ? `/api/community-icons/${row.candidate_id}`
      : null,
    joinMode: row.join_mode,
    joinUrl: row.join_url,
    lastVerifiedAt: row.last_verified_at.toISOString(),
    openToSharedChannels: row.open_to_shared_channels,
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
