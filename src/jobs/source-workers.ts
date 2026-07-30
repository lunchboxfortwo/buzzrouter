import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import { recordSourceFailure } from "../db/source-state";
import {
  isSourceEnabled,
  parseCsv,
  parsePubkeys,
  validateSourceRelays,
} from "../sources/config";
import { SourceAdapterError } from "../sources/errors";
import {
  createGitHubSearchClient,
  runGitHubSource,
} from "../sources/github";
import { createNostrQueryClient } from "../sources/nostr-client";
import { runNip65Source } from "../sources/nip65";
import { runNip66Source } from "../sources/nip66";
import {
  SOURCE_GITHUB_QUEUE,
  SOURCE_NIP65_QUEUE,
  SOURCE_NIP66_QUEUE,
} from "./queues";

export async function registerSourceWorkers(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(
    SOURCE_GITHUB_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      if (!isSourceEnabled("DISCOVERY_GITHUB_ENABLED")) {
        return;
      }

      for (const _job of jobs) {
        await runSafely(pool, "github", async () => {
          const token = process.env.GITHUB_TOKEN;
          if (!token) {
            throw new SourceAdapterError(
              "invalid_configuration",
              "GITHUB_TOKEN is required when GitHub discovery is enabled.",
            );
          }

          await runGitHubSource(
            pool,
            boss,
            createGitHubSearchClient(token),
          );
        });
      }
    },
  );

  await boss.work(
    SOURCE_NIP66_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      if (!isSourceEnabled("DISCOVERY_NIP66_ENABLED")) {
        return;
      }

      for (const _job of jobs) {
        await runSafely(pool, "nip66", async () => {
          const sourceRelays = await configuredSourceRelays(
            "NIP66_SOURCE_RELAYS",
          );
          const monitorPubkeys = parsePubkeys(
            process.env.NIP66_MONITOR_PUBKEYS,
            {
              field: "NIP66_MONITOR_PUBKEYS",
              maximum: 100,
              minimum: 2,
            },
          );

          await runNip66Source(
            pool,
            boss,
            createNostrQueryClient(),
            { monitorPubkeys, sourceRelays },
          );
        });
      }
    },
  );

  await boss.work(
    SOURCE_NIP65_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      if (!isSourceEnabled("DISCOVERY_NIP65_ENABLED")) {
        return;
      }

      for (const _job of jobs) {
        await runSafely(pool, "nip65", async () => {
          const sourceRelays = await configuredSourceRelays(
            "NIP65_SOURCE_RELAYS",
          );
          const authors = parsePubkeys(process.env.NIP65_AUTHORS, {
            field: "NIP65_AUTHORS",
            maximum: 500,
            minimum: 1,
          });

          await runNip65Source(
            pool,
            boss,
            createNostrQueryClient(),
            { authors, sourceRelays },
          );
        });
      }
    },
  );
}

async function configuredSourceRelays(name: string): Promise<string[]> {
  return validateSourceRelays(
    parseCsv(process.env[name], {
      field: name,
      maximum: 10,
      minimum: 1,
    }),
  );
}

async function runSafely(
  pool: Pool,
  sourceKey: string,
  run: () => Promise<void>,
): Promise<void> {
  await withSourceLock(pool, sourceKey, async () => {
    try {
      await run();
    } catch (error) {
      const code =
        error instanceof SourceAdapterError
          ? error.code
          : "remote_failed";
      await recordSourceFailure(pool, sourceKey, code);
      throw new Error(`Discovery source failed: ${sourceKey}:${code}.`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  });
}

export async function withSourceLock(
  pool: Pool,
  sourceKey: string,
  run: () => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  const lockName = `buzzrouter.discovery.${sourceKey}`;
  let acquired = false;

  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [lockName],
    );
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) {
      return false;
    }

    await run();
    return true;
  } finally {
    try {
      if (acquired) {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [lockName],
        );
      }
    } finally {
      client.release();
    }
  }
}
