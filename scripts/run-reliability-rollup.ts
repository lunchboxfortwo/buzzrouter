import { createDatabasePool } from "../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../src/db/readiness";
import { classifyPendingFocus } from "../src/ranking/classify-focus-job";
import { rollUpReliabilityMetrics } from "../src/ranking/reliability";

/**
 * Runs the hourly rollup once, on demand. The worker schedules the same work
 * at :45, but a fresh deployment should not have to wait out that window
 * before listings show real status. Both steps are idempotent.
 */
const pool = createDatabasePool();

try {
  await assertDiscoveryDatabaseReady(pool);
  const reliability = await rollUpReliabilityMetrics(pool);
  const focus = await classifyPendingFocus(pool);
  console.log(
    JSON.stringify({ focus, reliability }, null, 2),
  );
} finally {
  await pool.end();
}
