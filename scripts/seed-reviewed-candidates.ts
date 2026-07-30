import { readFile } from "node:fs/promises";
import path from "node:path";

import { PgBoss } from "pg-boss";

import { upsertCandidate } from "../src/db/candidates";
import {
  createDatabasePool,
  getDatabaseConnectionOptions,
} from "../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../src/db/readiness";
import { normalizeRelayUrl } from "../src/discovery/normalize";
import { parseReviewedRelaySeed } from "../src/discovery/reviewed-seed";
import { configureQueues, enqueueCandidateProbe } from "../src/jobs/queues";

const seedFile = path.resolve(
  process.env.DISCOVERY_SEED_FILE ?? "config/reviewed-relays.json",
);
const seed = parseReviewedRelaySeed(await readFile(seedFile, "utf8")).relays;
const pool = createDatabasePool();
const boss = new PgBoss(
  getDatabaseConnectionOptions("buzzrouter-seed"),
);
let bossStarted = false;

try {
  await assertDiscoveryDatabaseReady(pool);
  await boss.start();
  bossStarted = true;
  await configureQueues(boss);

  for (const entry of seed) {
    const relay = normalizeRelayUrl(entry.url);
    const candidate = await upsertCandidate(pool, relay, {
      type: "reviewed_seed",
      locator: entry.sourceLocator,
    });
    await enqueueCandidateProbe(boss, candidate.id);
  }

  console.log(`Queued ${seed.length} reviewed relay candidate(s).`);
} finally {
  if (bossStarted) {
    await boss.stop();
  }
  await pool.end();
}
