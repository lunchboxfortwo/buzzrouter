import { PgBoss } from "pg-boss";

import {
  getDatabaseConnectionOptions,
  getDatabasePool,
} from "./db/pool";
import { registerProbeCandidateWorker } from "./jobs/probe-candidate";
import { configureQueues } from "./jobs/queues";
import { registerDueProbeScheduler } from "./jobs/schedule-due-probes";

const pool = getDatabasePool();
const boss = new PgBoss(
  getDatabaseConnectionOptions("buzzrouter-worker"),
);

boss.on("error", (error) => {
  console.error("pg-boss error", error);
});

await boss.start();
await configureQueues(boss);
await registerProbeCandidateWorker(boss, pool);
await registerDueProbeScheduler(boss, pool);

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
