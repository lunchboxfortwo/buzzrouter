import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  configureQueues,
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
});
