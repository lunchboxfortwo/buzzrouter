import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  configureQueues,
  enqueueCandidateProbe,
  PROBE_CANDIDATE_QUEUE,
  SCHEDULE_DUE_PROBES_QUEUE,
} from "./queues";

describe("configureQueues", () => {
  it("creates probe and scheduler queues and installs the UTC cadence", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue, schedule } as unknown as PgBoss;

    await configureQueues(boss);

    expect(createQueue).toHaveBeenCalledWith(
      PROBE_CANDIDATE_QUEUE,
      expect.objectContaining({ retryLimit: 2 }),
    );
    expect(createQueue).toHaveBeenCalledWith(
      SCHEDULE_DUE_PROBES_QUEUE,
      expect.any(Object),
    );
    expect(schedule).toHaveBeenCalledWith(
      SCHEDULE_DUE_PROBES_QUEUE,
      "*/15 * * * *",
      null,
      {
        key: "phase1-due-probes",
        tz: "UTC",
      },
    );
  });

  it("deduplicates candidate jobs within the scheduler lease window", async () => {
    const send = vi.fn().mockResolvedValue("job-id");
    const boss = { send } as unknown as PgBoss;

    await expect(
      enqueueCandidateProbe(boss, "candidate-id"),
    ).resolves.toBe("job-id");
    expect(send).toHaveBeenCalledWith(
      PROBE_CANDIDATE_QUEUE,
      { candidateId: "candidate-id" },
      {
        singletonKey: "candidate-id",
        singletonSeconds: 60,
      },
    );
  });
});
