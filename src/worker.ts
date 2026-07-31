import { PgBoss } from "pg-boss";

import {
  getDatabaseConnectionOptions,
  getDatabasePool,
} from "./db/pool";
import { assertDiscoveryDatabaseReady } from "./db/readiness";
import { registerProbeCandidateWorker } from "./jobs/probe-candidate";
import { registerRefreshSummariesWorker } from "./jobs/refresh-community-summaries";
import { registerReliabilityRollupWorker } from "./jobs/reliability-rollup";
import { configureQueues } from "./jobs/queues";
import { registerDueProbeScheduler } from "./jobs/schedule-due-probes";
import { registerSourceWorkers } from "./jobs/source-workers";
import {
  ConnectorSupervisor,
  createFileWrappingKeyProvider,
  registerBridgeDeliveryWorker,
} from "./shared-channels/connector";

const pool = getDatabasePool();
const boss = new PgBoss(
  getDatabaseConnectionOptions("buzzrouter-worker"),
);

boss.on("error", (error) => {
  console.error("pg-boss error", error);
});

let bossStarted = false;
let connectorSupervisor: ConnectorSupervisor | undefined;
try {
  await assertDiscoveryDatabaseReady(pool);
  await boss.start();
  bossStarted = true;
  await configureQueues(boss);
  await registerProbeCandidateWorker(boss, pool);
  await registerDueProbeScheduler(boss, pool);
  await registerSourceWorkers(boss, pool);
  await registerReliabilityRollupWorker(boss, pool);
  await registerRefreshSummariesWorker(boss, pool);
  connectorSupervisor = new ConnectorSupervisor(
    pool,
    boss,
    createFileWrappingKeyProvider(),
  );
  await connectorSupervisor.start();
  await registerBridgeDeliveryWorker(boss, connectorSupervisor);
} catch (error) {
  await connectorSupervisor?.stop();
  if (bossStarted) {
    await boss.stop();
  }
  await pool.end();
  throw error;
}

async function shutdown(): Promise<void> {
  await connectorSupervisor?.stop();
  await boss.stop({ graceful: true, timeout: 30_000 });
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});
