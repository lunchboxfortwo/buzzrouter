import type { Pool } from "pg";

export interface DiscoveryStatus {
  candidatesByState: Record<string, number>;
  dueCandidates: number;
  probesLast24Hours: number;
  failuresLast24Hours: number;
  lastProbeAt: string | null;
}

export async function getDiscoveryStatus(
  pool: Pool,
): Promise<DiscoveryStatus> {
  const candidateResult = await pool.query<{
    state: string;
    count: string;
  }>(
    `
      SELECT state, count(*)::text AS count
      FROM community_candidates
      GROUP BY state
      ORDER BY state
    `,
  );
  const probeResult = await pool.query<{
    due_candidates: string;
    probes_last_24_hours: string;
    failures_last_24_hours: string;
    last_probe_at: Date | null;
  }>(`
    SELECT
      (
        SELECT count(*)::text
        FROM community_candidates
        WHERE next_probe_at <= now()
          AND state <> 'suppressed'
      ) AS due_candidates,
      count(*) FILTER (
        WHERE probed_at >= now() - interval '24 hours'
      )::text AS probes_last_24_hours,
      count(*) FILTER (
        WHERE probed_at >= now() - interval '24 hours'
          AND result_code NOT IN (
            'exact_software_and_protocol',
            'buzz_metadata_without_canonical_software',
            'different_software',
            'insufficient_buzz_evidence'
          )
      )::text AS failures_last_24_hours,
      max(probed_at) AS last_probe_at
    FROM probe_snapshots
  `);
  const probes = probeResult.rows[0];

  return {
    candidatesByState: Object.fromEntries(
      candidateResult.rows.map((row) => [row.state, Number(row.count)]),
    ),
    dueCandidates: Number(probes?.due_candidates ?? 0),
    probesLast24Hours: Number(probes?.probes_last_24_hours ?? 0),
    failuresLast24Hours: Number(probes?.failures_last_24_hours ?? 0),
    lastProbeAt: probes?.last_probe_at?.toISOString() ?? null,
  };
}
