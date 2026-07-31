import { PgBoss } from "pg-boss";

import {
  getDatabaseConnectionOptions,
  getDatabasePool,
} from "./db/pool";
import { assertDiscoveryDatabaseReady } from "./db/readiness";
import { registerProbeCandidateWorker } from "./jobs/probe-candidate";
import { registerRefreshSummariesWorker } from "./jobs/refresh-community-summaries";
import { registerReliabilityRollupWorker } from "./jobs/reliability-rollup";
import { configureQueues, REFRESH_SUMMARIES_QUEUE } from "./jobs/queues";
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
  // Kick one summary refresh on startup so a redeploy/restart populates
  // community summaries right away instead of waiting for the next 4h tick.
  // Best-effort: the job itself is per-community fault-tolerant, and a failed
  // enqueue must never take the worker down.
  try {
    await boss.send(REFRESH_SUMMARIES_QUEUE, null);
  } catch (error) {
    console.error("initial presence summary refresh enqueue failed", error);
  }
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
