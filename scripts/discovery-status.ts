import { createDatabasePool } from "../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../src/db/readiness";
import { getDiscoveryStatus } from "../src/db/status";

const pool = createDatabasePool();

try {
  await assertDiscoveryDatabaseReady(pool);
  console.log(JSON.stringify(await getDiscoveryStatus(pool), null, 2));
} finally {
  await pool.end();
}
