import { PgBoss } from "pg-boss";

import {
  getDatabaseConnectionOptions,
  getDatabasePool,
} from "./db/pool";
import { assertDiscoveryDatabaseReady } from "./db/readiness";
import { registerProbeCandidateWorker } from "./jobs/probe-candidate";
import { registerReliabilityRollupWorker } from "./jobs/reliability-rollup";
import { configureQueues } from "./jobs/queues";
import { registerDueProbeScheduler } from "./jobs/schedule-due-probes";
import { registerSourceWorkers } from "./jobs/source-workers";

const pool = getDatabasePool();
const boss = new PgBoss(
  getDatabaseConnectionOptions("buzzrouter-worker"),
);

boss.on("error", (error) => {
  console.error("pg-boss error", error);
});

let bossStarted = false;
try {
  await assertDiscoveryDatabaseReady(pool);
  await boss.start();
  bossStarted = true;
  await configureQueues(boss);
  await registerProbeCandidateWorker(boss, pool);
  await registerDueProbeScheduler(boss, pool);
  await registerSourceWorkers(boss, pool);
  await registerReliabilityRollupWorker(boss, pool);
} catch (error) {
  if (bossStarted) {
    await boss.stop();
  }
  await pool.end();
  throw error;
}

async function shutdown(): Promise<void> {
  await boss.stop({ graceful: true, timeout: 30_000 });
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});
