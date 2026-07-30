import type { PgBoss } from "pg-boss";

export const PROBE_CANDIDATE_QUEUE = "discovery.probe-candidate";

export interface ProbeCandidateJob {
  candidateId: string;
}

export async function configureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(PROBE_CANDIDATE_QUEUE, {
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    expireInSeconds: 60,
    retentionSeconds: 14 * 24 * 60 * 60,
    retryBackoff: true,
    retryDelay: 2 * 60 * 60,
    retryDelayMax: 24 * 60 * 60,
    retryLimit: 2,
  });
}

export async function enqueueCandidateProbe(
  boss: PgBoss,
  candidateId: string,
): Promise<string | null> {
  return boss.send(
    PROBE_CANDIDATE_QUEUE,
    { candidateId } satisfies ProbeCandidateJob,
    {
      singletonKey: candidateId,
      singletonSeconds: 5 * 60,
    },
  );
}
