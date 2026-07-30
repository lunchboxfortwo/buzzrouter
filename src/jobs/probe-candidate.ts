import type { Job, PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  getCandidate,
  markCandidateProbing,
  recordProbeResult,
} from "../db/candidates";
import { probeRelay } from "../discovery/probe";
import {
  PROBE_CANDIDATE_QUEUE,
  type ProbeCandidateJob,
} from "./queues";

export async function registerProbeCandidateWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work<ProbeCandidateJob>(
    PROBE_CANDIDATE_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await processProbeCandidateJob(pool, job);
      }
    },
  );
}

export async function processProbeCandidateJob(
  pool: Pool,
  job: Job<ProbeCandidateJob>,
): Promise<void> {
  const candidate = await getCandidate(pool, job.data.candidateId);
  if (!candidate) {
    return;
  }

  await markCandidateProbing(pool, candidate.id);
  const result = await probeRelay(candidate.canonicalRelayUrl);
  await recordProbeResult(pool, candidate.id, result);

  if (!result.ok) {
    throw new Error(`Relay probe failed: ${result.resultCode}`);
  }
}
