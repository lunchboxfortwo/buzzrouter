import { PgBoss } from "pg-boss";

import {
  createDatabasePool,
  getDatabaseConnectionOptions,
} from "../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../src/db/readiness";
import { configureQueues } from "../src/jobs/queues";
import {
  createGitHubSearchClient,
  runGitHubSource,
} from "../src/sources/github";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  throw new Error("GITHUB_TOKEN is required for GitHub discovery.");
}
const baseUrl =
  process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";

const pool = createDatabasePool();
const boss = new PgBoss(
  getDatabaseConnectionOptions("buzzrouter-github-source"),
);
let bossStarted = false;

try {
  await assertDiscoveryDatabaseReady(pool);
  await boss.start();
  bossStarted = true;
  await configureQueues(boss);

  const result = await runGitHubSource(
    pool,
    boss,
    createGitHubSearchClient(token, baseUrl),
  );
  console.log(JSON.stringify(result));
} finally {
  if (bossStarted) {
    await boss.stop();
  }
  await pool.end();
}
