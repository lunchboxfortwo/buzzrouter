import { PgBoss } from "pg-boss";

import { getDatabasePool } from "./db/pool";
import { registerProbeCandidateWorker } from "./jobs/probe-candidate";
import { configureQueues } from "./jobs/queues";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const pool = getDatabasePool();
const boss = new PgBoss({
  application_name: "buzzrouter-worker",
  connectionString,
});

boss.on("error", (error) => {
  console.error("pg-boss error", error);
});

await boss.start();
await configureQueues(boss);
await registerProbeCandidateWorker(boss, pool);

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
