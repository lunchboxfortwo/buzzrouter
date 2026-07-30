import type { Pool } from "pg";

/**
 * Activity is composed from what BuzzRouter can observe first-hand or from
 * signed public records. It never uses message volume, member counts, or any
 * private relay content.
 *
 * - Adoption: distinct pubkeys naming the relay in signed NIP-65 relay lists,
 *   plus distinct public code references. This is the popularity proxy.
 * - Liveness: BuzzRouter's own probe successes and recency.
 * - Tending: whether the operator has touched the relay's published metadata.
 */
export const ACTIVITY_WEIGHTS = {
  adoption: 0.5,
  liveness: 0.3,
  tending: 0.2,
} as const;

export const ACTIVITY_WINDOW_DAYS = 30;

/**
 * Adoption saturates: the difference between 5 and 50 declared relay lists is
 * meaningful, the difference between 500 and 5000 is not. Log damping keeps a
 * large community from burying a healthy small one.
 */
export const ADOPTION_SATURATION = 250;

/** Below this, we say "Limited evidence" rather than publish a number. */
export const EVIDENCE_FLOOR = {
  adoptionPubkeys: 3,
  probesTotal: 5,
} as const;

export interface ActivityInputs {
  adoptionPubkeys: number;
  adoptionRepos: number;
  metadataChangedAt: Date | null;
  probesSuccessful: number;
  probesTotal: number;
}

export interface ActivityScores {
  activityScore: number;
  adoptionScore: number;
  evidenceSufficient: boolean;
  livenessScore: number;
  tendingScore: number;
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

const round = (value: number): number => Math.round(value * 100) / 100;

export function scoreAdoption(pubkeys: number, repos: number): number {
  const weighted = Math.max(0, pubkeys) + Math.max(0, repos) * 0.5;
  if (weighted <= 0) return 0;
  const damped = Math.log1p(weighted) / Math.log1p(ADOPTION_SATURATION);
  return round(clamp(damped * 100));
}

export function scoreLiveness(successful: number, total: number): number {
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
  const windowMs = ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  if (ageMs >= windowMs) return 0;
  return round(clamp((1 - ageMs / windowMs) * 100));
}

export function scoreActivity(
  inputs: ActivityInputs,
  now: Date = new Date(),
): ActivityScores {
  const adoptionScore = scoreAdoption(
    inputs.adoptionPubkeys,
    inputs.adoptionRepos,
  );
  const livenessScore = scoreLiveness(
    inputs.probesSuccessful,
    inputs.probesTotal,
  );
  const tendingScore = scoreTending(inputs.metadataChangedAt, now);

  const activityScore = round(
    clamp(
      adoptionScore * ACTIVITY_WEIGHTS.adoption +
        livenessScore * ACTIVITY_WEIGHTS.liveness +
        tendingScore * ACTIVITY_WEIGHTS.tending,
    ),
  );

  return {
    activityScore,
    adoptionScore,
    evidenceSufficient:
      inputs.adoptionPubkeys >= EVIDENCE_FLOOR.adoptionPubkeys &&
      inputs.probesTotal >= EVIDENCE_FLOOR.probesTotal,
    livenessScore,
    tendingScore,
  };
}

export interface ActivityRollupResult {
  candidatesUpdated: number;
}

/**
 * Recomputes the activity rollup for every candidate that has been probed
 * inside the window. Idempotent: re-running replaces each row in place.
 */
export async function rollUpActivityMetrics(
  pool: Pool,
): Promise<ActivityRollupResult> {
  const result = await pool.query(
    `
      WITH windowed AS (
        SELECT
          candidates.id AS candidate_id,
          COALESCE(adoption.pubkeys, 0) AS adoption_pubkeys,
          COALESCE(adoption.repos, 0) AS adoption_repos,
          COALESCE(probes.total, 0) AS probes_total,
          COALESCE(probes.successful, 0) AS probes_successful,
          metadata.changed_at AS metadata_changed_at
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
        WHERE candidates.state IN ('verified_buzz', 'probable_buzz')
      )
      INSERT INTO community_activity_metrics AS metrics (
        candidate_id,
        computed_at,
        window_days,
        adoption_pubkeys,
        adoption_repos,
        adoption_score,
        probes_total,
        probes_successful,
        liveness_score,
        metadata_changed_at,
        tending_score,
        activity_score,
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
        liveness_score,
        metadata_changed_at,
        tending_score,
        LEAST(
          100,
          GREATEST(
            0,
            round(
              adoption_score * $2 + liveness_score * $3 + tending_score * $4,
              2
            )
          )
        ),
        adoption_pubkeys >= $5 AND probes_total >= $6
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
          END AS liveness_score,
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
          END AS tending_score
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
        liveness_score = EXCLUDED.liveness_score,
        metadata_changed_at = EXCLUDED.metadata_changed_at,
        tending_score = EXCLUDED.tending_score,
        activity_score = EXCLUDED.activity_score,
        evidence_sufficient = EXCLUDED.evidence_sufficient
      WHERE metrics.candidate_id = EXCLUDED.candidate_id
    `,
    [
      ACTIVITY_WINDOW_DAYS,
      ACTIVITY_WEIGHTS.adoption,
      ACTIVITY_WEIGHTS.liveness,
      ACTIVITY_WEIGHTS.tending,
      EVIDENCE_FLOOR.adoptionPubkeys,
      EVIDENCE_FLOOR.probesTotal,
      ADOPTION_SATURATION,
    ],
  );

  return { candidatesUpdated: result.rowCount ?? 0 };
}
