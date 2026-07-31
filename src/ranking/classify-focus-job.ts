import type { Pool } from "pg";

import { classifyFocus } from "./classify-focus";

export interface FocusClassificationResult {
  classified: number;
  considered: number;
}

/**
 * Fills in `communities.focus` for listings a human has not ruled on.
 *
 * Rows whose `focus_source` is 'operator' or 'confirmed' are never touched, so
 * re-running can only ever overwrite the classifier's own earlier guess.
 */
export async function classifyPendingFocus(
  pool: Pool,
): Promise<FocusClassificationResult> {
  const { rows } = await pool.query<{
    candidate_id: string;
    github_locators: string[];
    host: string;
    relay_description: string | null;
  }>(
    `
      SELECT
        candidates.id AS candidate_id,
        candidates.host,
        latest.relay_description,
        COALESCE(
          (
            SELECT array_agg(source_locator)
            FROM community_sources
            WHERE candidate_id = candidates.id
              AND source_type = 'github'
              AND source_locator IS NOT NULL
          ),
          '{}'::text[]
        ) AS github_locators
      FROM community_candidates AS candidates
      LEFT JOIN communities
        ON communities.candidate_id = candidates.id
      LEFT JOIN LATERAL (
        SELECT relay_description
        FROM probe_snapshots
        WHERE candidate_id = candidates.id
          AND result_code = 'exact_software_and_protocol'
        ORDER BY probed_at DESC
        LIMIT 1
      ) AS latest ON true
      WHERE candidates.state IN ('verified_buzz', 'probable_buzz')
        AND (
          communities.focus_source IS NULL
          OR communities.focus_source = 'classified'
        )
    `,
  );

  let classified = 0;

  for (const row of rows) {
    const result = classifyFocus({
      description: row.relay_description,
      githubLocators: row.github_locators,
      host: row.host,
    });
    if (!result) continue;

    await pool.query(
      `
        INSERT INTO communities (candidate_id, focus, focus_source)
        VALUES ($1, $2, 'classified')
        ON CONFLICT (candidate_id) DO UPDATE
          SET focus = EXCLUDED.focus,
              focus_source = 'classified',
              updated_at = now()
          WHERE communities.focus_source IS NULL
            OR communities.focus_source = 'classified'
      `,
      [row.candidate_id, result.focus],
    );
    classified += 1;
  }

  return { classified, considered: rows.length };
}
