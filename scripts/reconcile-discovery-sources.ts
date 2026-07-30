import { PgBoss } from "pg-boss";

import {
  createDatabasePool,
  getDatabaseConnectionOptions,
} from "../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../src/db/readiness";
import {
  configureQueues,
  enqueueSourceReconciliation,
} from "../src/jobs/queues";

const pool = createDatabasePool();
const boss = new PgBoss(
  getDatabaseConnectionOptions("buzzrouter-reconcile-sources"),
);
let bossStarted = false;

try {
  await assertDiscoveryDatabaseReady(pool);
  await boss.start();
  bossStarted = true;
  await configureQueues(boss);
  await enqueueSourceReconciliation(boss);
  console.log("Queued GitHub, NIP-66, and NIP-65 reconciliation jobs.");
} finally {
  if (bossStarted) {
    await boss.stop();
  }
  await pool.end();
}
