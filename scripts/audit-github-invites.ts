/**
 * Read-only production audit for GitHub invite harvesting.
 *
 * It prints aggregate counts only. Invite codes and community hosts are bearer-
 * credential context and must never appear in stdout/stderr.
 */
import { createDatabasePool } from "../src/db/pool";
import {
  extractInviteCode,
  fetchGitHubSourceText,
} from "../src/sources/github";

const pool = createDatabasePool();

try {
  const result = await pool.query<{
    canonical_relay_url: string;
    source_locator: string;
  }>(
    `
      SELECT cc.canonical_relay_url, cs.source_locator
      FROM community_sources cs
      JOIN community_candidates cc ON cc.id = cs.candidate_id
      WHERE cs.source_type = 'github'
        AND cs.source_locator IS NOT NULL
      ORDER BY cs.id
    `,
  );

  let rowsWithCode = 0;
  for (const row of result.rows) {
    try {
      const sourceText = await fetchGitHubSourceText(row.source_locator);
      if (extractInviteCode(sourceText, row.canonical_relay_url)) {
        rowsWithCode += 1;
      }
    } catch {
      // A stale/deleted GitHub file is a zero-yield row, not an audit failure.
    }
  }

  console.log(
    JSON.stringify({
      githubRows: result.rows.length,
      rowsWithHarvestableCode: rowsWithCode,
    }),
  );
} finally {
  await pool.end();
}
