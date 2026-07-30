import type { Pool } from "pg";

/**
 * Reliability is composed from what BuzzRouter can observe first-hand or from
 * signed public records. It never uses message volume, member counts, or any
 * private relay content.
 *
 * - Uptime: BuzzRouter's own probe successes in the window.
 * - Tending: whether the operator has touched the relay's published metadata.
 * - Corroboration: how many independent evidence sources (probes, GitHub,
 *   NIP-66 monitors) have observed this relay at all.
 * - Adoption: distinct pubkeys naming the relay in signed NIP-65 relay lists,
 *   plus distinct public code references. NIP-65 is disabled in production
 *   today, so this weight is zero until ADOPTION_ENABLED flips.
 */
export const ADOPTION_ENABLED = false;

export const RELIABILITY_WEIGHTS = {
  uptime: 0.55,
  tending: 0.25,
  corroboration: 0.2,
  adoption: ADOPTION_ENABLED ? 0.5 : 0,
} as const;

export const RELIABILITY_WINDOW_DAYS = 30;

/**
 * Adoption saturates: the difference between 5 and 50 declared relay lists is
 * meaningful, the difference between 500 and 5000 is not. Log damping keeps a
 * large community from burying a healthy small one.
 */
export const ADOPTION_SATURATION = 250;

/**
 * Corroboration saturates fast: BuzzRouter only has a handful of source
 * types today (probes, GitHub, NIP-66), so being seen by all of them is
 * already maximal confidence.
 */
export const CORROBORATION_SATURATION = 6;

/** Below this, we say "New" rather than publish a number. */
export const EVIDENCE_FLOOR = {
  probesTotal: 5,
} as const;

export interface ReliabilityInputs {
  adoptionPubkeys: number;
  adoptionRepos: number;
  corroborationSources: number;
  metadataChangedAt: Date | null;
  probesSuccessful: number;
  probesTotal: number;
}

export interface ReliabilityScores {
  adoptionScore: number;
  corroborationScore: number;
  evidenceSufficient: boolean;
  reliabilityScore: number;
  tendingScore: number;
  uptimeScore: number;
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

const round = (value: number): number => Math.round(value * 100) / 100;

export function scoreAdoption(pubkeys: number, repos: number): number {
  const weighted = Math.max(0, pubkeys) + Math.max(0, repos) * 0.5;
  if (weighted <= 0) return 0;
  const damped = Math.log1p(weighted) / Math.log1p(ADOPTION_SATURATION);
  return round(clamp(damped * 100));
}

export function scoreUptime(successful: number, total: number): number {
  if (total <= 0) return 0;
  const ratio = Math.min(successful, total) / total;
  return round(clamp(ratio * 100));
}

/**
 * A relay whose operator refreshed its published metadata this week is tended
 * in a way uptime alone cannot show. The signal decays over the window and
 * contributes nothing once the metadata is older than the window.
 */
export function scoreTending(
  metadataChangedAt: Date | null,
  now: Date = new Date(),
): number {
  if (!metadataChangedAt) return 0;
  const ageMs = now.getTime() - metadataChangedAt.getTime();
  if (ageMs < 0) return 0;
  const windowMs = RELIABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  if (ageMs >= windowMs) return 0;
  return round(clamp((1 - ageMs / windowMs) * 100));
}

/**
 * Damped like adoption, but on independent source types rather than
 * pubkeys: being seen by several different kinds of observer is stronger
 * evidence than many observations from the same one.
 */
export function scoreCorroboration(distinctSources: number): number {
  const sources = Math.max(0, distinctSources);
  if (sources <= 0) return 0;
  const damped = Math.log1p(sources) / Math.log1p(CORROBORATION_SATURATION);
  return round(clamp(damped * 100));
}

export function scoreReliability(
  inputs: ReliabilityInputs,
  now: Date = new Date(),
): ReliabilityScores {
  const adoptionScore = scoreAdoption(
    inputs.adoptionPubkeys,
    inputs.adoptionRepos,
  );
  const uptimeScore = scoreUptime(
    inputs.probesSuccessful,
    inputs.probesTotal,
  );
  const tendingScore = scoreTending(inputs.metadataChangedAt, now);
  const corroborationScore = scoreCorroboration(inputs.corroborationSources);

  const reliabilityScore = round(
    clamp(
      uptimeScore * RELIABILITY_WEIGHTS.uptime +
        tendingScore * RELIABILITY_WEIGHTS.tending +
        corroborationScore * RELIABILITY_WEIGHTS.corroboration +
        adoptionScore * RELIABILITY_WEIGHTS.adoption,
    ),
  );

  return {
    adoptionScore,
    corroborationScore,
    evidenceSufficient: inputs.probesTotal >= EVIDENCE_FLOOR.probesTotal,
    reliabilityScore,
    tendingScore,
    uptimeScore,
  };
}

export interface ReliabilityRollupResult {
  candidatesUpdated: number;
}

/**
 * Recomputes the reliability rollup for every candidate that has been probed
 * inside the window. Idempotent: re-running replaces each row in place.
 * Corroboration is cumulative (all-time), unlike the other windowed inputs,
 * because it measures how many kinds of observer have ever seen this relay.
 */
export async function rollUpReliabilityMetrics(
  pool: Pool,
): Promise<ReliabilityRollupResult> {
  const result = await pool.query(
    `
      WITH windowed AS (
        SELECT
          candidates.id AS candidate_id,
          COALESCE(adoption.pubkeys, 0) AS adoption_pubkeys,
          COALESCE(adoption.repos, 0) AS adoption_repos,
          COALESCE(probes.total, 0) AS probes_total,
          COALESCE(probes.successful, 0) AS probes_successful,
          metadata.changed_at AS metadata_changed_at,
          COALESCE(corroboration.sources, 0) AS corroboration_sources
        FROM community_candidates AS candidates
        LEFT JOIN LATERAL (
          SELECT
            count(DISTINCT source_actor_pubkey)
              FILTER (
                WHERE source_type = 'nip65'
                  AND source_actor_pubkey IS NOT NULL
              ) AS pubkeys,
            count(DISTINCT evidence_hash)
              FILTER (WHERE source_type = 'github') AS repos
          FROM community_sources
          WHERE candidate_id = candidates.id
            AND source_observed_at >= now() - ($1 || ' days')::interval
        ) AS adoption ON true
        LEFT JOIN LATERAL (
          SELECT
            count(*) AS total,
            count(*) FILTER (
              WHERE result_code = 'exact_software_and_protocol'
                AND tls_valid = true
            ) AS successful
          FROM probe_snapshots
          WHERE candidate_id = candidates.id
            AND probed_at >= now() - ($1 || ' days')::interval
        ) AS probes ON true
        LEFT JOIN LATERAL (
          SELECT max(probed_at) AS changed_at
          FROM (
            SELECT
              probed_at,
              relay_description,
              software_version,
              lag(relay_description) OVER (ORDER BY probed_at) AS prev_description,
              lag(software_version) OVER (ORDER BY probed_at) AS prev_version
            FROM probe_snapshots
            WHERE candidate_id = candidates.id
              AND result_code = 'exact_software_and_protocol'
              AND probed_at >= now() - ($1 || ' days')::interval
          ) AS history
          WHERE prev_description IS NOT NULL
            AND (
              relay_description IS DISTINCT FROM prev_description
              OR software_version IS DISTINCT FROM prev_version
            )
        ) AS metadata ON true
        LEFT JOIN LATERAL (
          SELECT count(DISTINCT source_type) AS sources
          FROM community_sources
          WHERE candidate_id = candidates.id
        ) AS corroboration ON true
        WHERE candidates.state IN ('verified_buzz', 'probable_buzz')
      )
      INSERT INTO community_reliability_metrics AS metrics (
        candidate_id,
        computed_at,
        window_days,
        adoption_pubkeys,
        adoption_repos,
        adoption_score,
        probes_total,
        probes_successful,
        uptime_score,
        metadata_changed_at,
        tending_score,
        corroboration_sources,
        corroboration_score,
        reliability_score,
        evidence_sufficient
      )
      SELECT
        candidate_id,
        now(),
        $1,
        adoption_pubkeys,
        adoption_repos,
        adoption_score,
        probes_total,
        probes_successful,
        uptime_score,
        metadata_changed_at,
        tending_score,
        corroboration_sources,
        corroboration_score,
        LEAST(
          100,
          GREATEST(
            0,
            round(
              uptime_score * $2
                + tending_score * $3
                + corroboration_score * $4
                + adoption_score * $5,
              2
            )
          )
        ),
        probes_total >= $6
      FROM (
        SELECT
          windowed.*,
          LEAST(
            100,
            round(
              (
                ln(1 + adoption_pubkeys + adoption_repos * 0.5)
                / ln(1 + $7::numeric)
              ) * 100,
              2
            )
          ) AS adoption_score,
          CASE
            WHEN probes_total = 0 THEN 0
            ELSE round((probes_successful::numeric / probes_total) * 100, 2)
          END AS uptime_score,
          CASE
            WHEN metadata_changed_at IS NULL THEN 0
            ELSE GREATEST(
              0,
              round(
                (
                  1 - (
                    EXTRACT(EPOCH FROM now() - metadata_changed_at)
                    / ($1 * 24 * 60 * 60)
                  )
                ) * 100,
                2
              )
            )
          END AS tending_score,
          CASE
            WHEN corroboration_sources <= 0 THEN 0
            ELSE LEAST(
              100,
              round(
                (
                  ln(1 + corroboration_sources)
                  / ln(1 + $8::numeric)
                ) * 100,
                2
              )
            )
          END AS corroboration_score
        FROM windowed
      ) AS scored
      ON CONFLICT (candidate_id) DO UPDATE SET
        computed_at = EXCLUDED.computed_at,
        window_days = EXCLUDED.window_days,
        adoption_pubkeys = EXCLUDED.adoption_pubkeys,
        adoption_repos = EXCLUDED.adoption_repos,
        adoption_score = EXCLUDED.adoption_score,
        probes_total = EXCLUDED.probes_total,
        probes_successful = EXCLUDED.probes_successful,
        uptime_score = EXCLUDED.uptime_score,
        metadata_changed_at = EXCLUDED.metadata_changed_at,
        tending_score = EXCLUDED.tending_score,
        corroboration_sources = EXCLUDED.corroboration_sources,
        corroboration_score = EXCLUDED.corroboration_score,
        reliability_score = EXCLUDED.reliability_score,
        evidence_sufficient = EXCLUDED.evidence_sufficient
      WHERE metrics.candidate_id = EXCLUDED.candidate_id
    `,
    [
      RELIABILITY_WINDOW_DAYS,
      RELIABILITY_WEIGHTS.uptime,
      RELIABILITY_WEIGHTS.tending,
      RELIABILITY_WEIGHTS.corroboration,
      RELIABILITY_WEIGHTS.adoption,
      EVIDENCE_FLOOR.probesTotal,
      ADOPTION_SATURATION,
      CORROBORATION_SATURATION,
    ],
  );

  return { candidatesUpdated: result.rowCount ?? 0 };
}
