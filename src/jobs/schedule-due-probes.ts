import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import { claimDueCandidateIds } from "../db/candidates";
import {
  enqueueCandidateProbe,
  SCHEDULE_DUE_PROBES_QUEUE,
} from "./queues";

export async function registerDueProbeScheduler(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(
    SCHEDULE_DUE_PROBES_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const _job of jobs) {
        const candidateIds = await claimDueCandidateIds(pool);
        for (const candidateId of candidateIds) {
          await enqueueCandidateProbe(boss, candidateId);
        }
      }
    },
  );
}
