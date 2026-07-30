import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  addReviewedRelay,
  parseReviewedRelaySeed,
  serializeReviewedRelaySeed,
} from "../src/discovery/reviewed-seed";

const seedFile = path.resolve(
  process.env.DISCOVERY_SEED_FILE ?? "config/reviewed-relays.json",
);
const readline = createInterface({ input: stdin, output: stdout });

try {
  const relayInput = await readline.question("Relay or invite URL: ");
  const sourceInput = await readline.question(
    "Public source URL (optional): ",
  );
  const existing = await readSeedFile(seedFile);
  const updated = addReviewedRelay(
    existing,
    relayInput.trim(),
    sourceInput.trim() || undefined,
  );
  const temporaryFile = `${seedFile}.${process.pid}.tmp`;

  await writeFile(
    temporaryFile,
    serializeReviewedRelaySeed(updated),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await rename(temporaryFile, seedFile);
  console.log(`Saved ${updated.relays.length} reviewed relay record(s).`);
} finally {
  readline.close();
}

async function readSeedFile(file: string) {
  try {
    return parseReviewedRelaySeed(await readFile(file, "utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { relays: [] };
    }

    throw error;
  }
}
