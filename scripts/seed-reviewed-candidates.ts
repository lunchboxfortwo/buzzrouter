import { readFile } from "node:fs/promises";
import path from "node:path";

import { PgBoss } from "pg-boss";

import { upsertCandidate } from "../src/db/candidates";
import { createDatabasePool } from "../src/db/pool";
import { normalizeRelayUrl } from "../src/discovery/normalize";
import { configureQueues, enqueueCandidateProbe } from "../src/jobs/queues";

interface SeedEntry {
  url: string;
  sourceLocator?: string;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const seedFile = path.resolve(
  process.env.DISCOVERY_SEED_FILE ?? "config/reviewed-relays.json",
);
const seed = parseSeedFile(await readFile(seedFile, "utf8"));
const pool = createDatabasePool();
const boss = new PgBoss({
  application_name: "buzzrouter-seed",
  connectionString,
});

try {
  await boss.start();
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
  await boss.stop();
  await pool.end();
}

function parseSeedFile(contents: string): SeedEntry[] {
  const parsed: unknown = JSON.parse(contents);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("relays" in parsed) ||
    !Array.isArray(parsed.relays)
  ) {
    throw new Error("Seed file must contain a relays array.");
  }

  return parsed.relays.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("url" in entry) ||
      typeof entry.url !== "string" ||
      ("sourceLocator" in entry &&
        entry.sourceLocator !== undefined &&
        typeof entry.sourceLocator !== "string")
    ) {
      throw new Error("Seed entries must contain URL strings.");
    }

    return {
      url: entry.url,
      sourceLocator:
        "sourceLocator" in entry ? entry.sourceLocator : undefined,
    };
  });
}
