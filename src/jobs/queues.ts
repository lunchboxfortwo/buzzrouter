import type { PgBoss } from "pg-boss";

export const PROBE_CANDIDATE_QUEUE = "discovery.probe-candidate";
export const SCHEDULE_DUE_PROBES_QUEUE = "discovery.schedule-due-probes";
export const SOURCE_GITHUB_QUEUE = "discovery.source-github";
export const SOURCE_NIP66_QUEUE = "discovery.source-nip66";
export const SOURCE_NIP65_QUEUE = "discovery.source-nip65";
export const RELIABILITY_ROLLUP_QUEUE = "discovery.reliability-rollup";

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

  await boss.createQueue(SCHEDULE_DUE_PROBES_QUEUE, {
    deleteAfterSeconds: 24 * 60 * 60,
    expireInSeconds: 60,
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
  });

  await boss.createQueue(RELIABILITY_ROLLUP_QUEUE, {
    deleteAfterSeconds: 24 * 60 * 60,
    expireInSeconds: 10 * 60,
    retryBackoff: true,
    retryDelay: 5 * 60,
    retryLimit: 2,
  });

  for (const sourceQueue of [
    SOURCE_GITHUB_QUEUE,
    SOURCE_NIP66_QUEUE,
    SOURCE_NIP65_QUEUE,
  ]) {
    await boss.createQueue(sourceQueue, {
      deleteAfterSeconds: 7 * 24 * 60 * 60,
      expireInSeconds: 15 * 60,
      retryBackoff: true,
      retryDelay: 5 * 60,
      retryDelayMax: 60 * 60,
      retryLimit: 2,
    });
  }

  await boss.schedule(
    SCHEDULE_DUE_PROBES_QUEUE,
    "*/15 * * * *",
    null,
    {
      key: "phase1-due-probes",
      tz: "UTC",
    },
  );

  await boss.schedule(SOURCE_GITHUB_QUEUE, "5 0 * * *", null, {
    key: "phase2-github",
    tz: "UTC",
  });
  await boss.schedule(SOURCE_NIP66_QUEUE, "15 1 * * *", null, {
    key: "phase2-nip66",
    tz: "UTC",
  });
  await boss.schedule(SOURCE_NIP65_QUEUE, "30 2 * * *", null, {
    key: "phase2-nip65",
    tz: "UTC",
  });
  await boss.schedule(RELIABILITY_ROLLUP_QUEUE, "45 * * * *", null, {
    key: "phase3-reliability-rollup",
    tz: "UTC",
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
      singletonSeconds: 60,
    },
  );
}

export async function enqueueSourceReconciliation(
  boss: PgBoss,
): Promise<void> {
  for (const queue of [
    SOURCE_GITHUB_QUEUE,
    SOURCE_NIP66_QUEUE,
    SOURCE_NIP65_QUEUE,
  ]) {
    await boss.send(queue, null, {
      singletonKey: "manual-reconciliation",
      singletonSeconds: 60,
    });
  }
}
