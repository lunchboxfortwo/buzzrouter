import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import { rollUpActivityMetrics } from "../ranking/activity";
import { ACTIVITY_ROLLUP_QUEUE } from "./queues";
import { withSourceLock } from "./source-workers";

export async function registerActivityRollupWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(ACTIVITY_ROLLUP_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const _job of jobs) {
      await withSourceLock(pool, "activity-rollup", async () => {
        await rollUpActivityMetrics(pool);
      });
    }
  });
}
