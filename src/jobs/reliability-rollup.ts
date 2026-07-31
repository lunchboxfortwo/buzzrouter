import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import { classifyPendingFocus } from "../ranking/classify-focus-job";
import { rollUpReliabilityMetrics } from "../ranking/reliability";
import { RELIABILITY_ROLLUP_QUEUE } from "./queues";
import { withSourceLock } from "./source-workers";

export async function registerReliabilityRollupWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(RELIABILITY_ROLLUP_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const _job of jobs) {
      await withSourceLock(pool, "reliability-rollup", async () => {
        await rollUpReliabilityMetrics(pool);
        await classifyPendingFocus(pool);
      });
    }
  });
}
