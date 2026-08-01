import {
  createDatabasePool,
} from "../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../src/db/readiness";
import { harvestXInvites } from "../src/jobs/harvest-x-invites";
import { createXSearchClient } from "../src/sources/x-search";

/**
 * One-shot X invite discovery pass (same logic as the scheduled worker job).
 * Requires X_BEARER_TOKEN. Does not need DISCOVERY_X_ENABLED — this script is
 * an explicit operator run.
 */

const token = process.env.X_BEARER_TOKEN;
if (!token) {
  throw new Error("X_BEARER_TOKEN is required for X invite discovery.");
}

const pool = createDatabasePool();

try {
  await assertDiscoveryDatabaseReady(pool);
  const result = await harvestXInvites({
    client: createXSearchClient(token),
    pool,
  });
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
