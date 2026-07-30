import { PgBoss } from "pg-boss";

import {
  createDatabasePool,
  getDatabaseConnectionOptions,
} from "../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../src/db/readiness";
import { withSourceLock } from "../src/jobs/source-workers";
import { configureQueues } from "../src/jobs/queues";
import { loadNip66SourceConfig } from "../src/sources/config";
import { createNostrQueryClient } from "../src/sources/nostr-client";
import {
  runNip66Source,
  type Nip66SourceResult,
} from "../src/sources/nip66";

const config = await loadNip66SourceConfig();
const pool = createDatabasePool();
const boss = new PgBoss(
  getDatabaseConnectionOptions("buzzrouter-nip66-source"),
);
let bossStarted = false;

try {
  await assertDiscoveryDatabaseReady(pool);
  await boss.start();
  bossStarted = true;
  await configureQueues(boss);

  let result: Nip66SourceResult | undefined;
  const acquired = await withSourceLock(pool, "nip66", async () => {
    result = await runNip66Source(
      pool,
      boss,
      createNostrQueryClient(),
      config,
    );
  });

  console.log(
    JSON.stringify(
      acquired ? result : { skipped: true, reason: "source_locked" },
    ),
  );
} finally {
  if (bossStarted) {
    await boss.stop();
  }
  await pool.end();
}
