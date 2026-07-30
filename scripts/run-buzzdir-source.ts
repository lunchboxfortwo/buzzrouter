import { PgBoss } from "pg-boss";

import {
  createDatabasePool,
  getDatabaseConnectionOptions,
} from "../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../src/db/readiness";
import { withSourceLock } from "../src/jobs/source-workers";
import { configureQueues } from "../src/jobs/queues";
import {
  createBuzzdirCatalogClient,
  runBuzzdirSource,
} from "../src/sources/buzzdir";

const pool = createDatabasePool();
const boss = new PgBoss(
  getDatabaseConnectionOptions("buzzrouter-buzzdir-source"),
);
let bossStarted = false;

try {
  await assertDiscoveryDatabaseReady(pool);
  await boss.start();
  bossStarted = true;
  await configureQueues(boss);

  let result;
  const acquired = await withSourceLock(pool, "buzzdir", async () => {
    result = await runBuzzdirSource(
      pool,
      boss,
      createBuzzdirCatalogClient(),
    );
  });
  console.log(JSON.stringify(acquired ? result : { skipped: "locked" }));
} finally {
  if (bossStarted) {
    await boss.stop();
  }
  await pool.end();
}
