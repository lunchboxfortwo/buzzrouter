import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  AUTO_JOIN_QUEUE,
  RELIABILITY_ROLLUP_QUEUE,
  BRIDGE_DELIVERY_QUEUE,
  configureQueues,
  enqueueCandidateProbe,
  HARVEST_INVITES_QUEUE,
  PROBE_CANDIDATE_QUEUE,
  REFRESH_INVITES_QUEUE,
  REFRESH_SUMMARIES_QUEUE,
  SCHEDULE_DUE_PROBES_QUEUE,
  SOURCE_GITHUB_QUEUE,
  SOURCE_NIP65_QUEUE,
  SOURCE_NIP66_QUEUE,
  SOURCE_X_QUEUE,
} from "./queues";

describe("configureQueues", () => {
  it("creates probe and scheduler queues and installs the UTC cadence", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue, schedule } as unknown as PgBoss;

    await configureQueues(boss);

    expect(createQueue).toHaveBeenCalledWith(
      BRIDGE_DELIVERY_QUEUE,
      expect.objectContaining({
        retryLimit: 8,
      }),
    );
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
    expect(createQueue).toHaveBeenCalledWith(
      SOURCE_GITHUB_QUEUE,
      expect.objectContaining({ retryLimit: 2 }),
    );
    expect(createQueue).toHaveBeenCalledWith(
      SOURCE_NIP66_QUEUE,
      expect.objectContaining({ retryLimit: 2 }),
    );
    expect(createQueue).toHaveBeenCalledWith(
      SOURCE_NIP65_QUEUE,
      expect.objectContaining({ retryLimit: 2 }),
    );
    expect(createQueue).toHaveBeenCalledWith(
      SOURCE_X_QUEUE,
      expect.objectContaining({ retryLimit: 2 }),
    );
    expect(schedule).toHaveBeenCalledWith(
      SOURCE_GITHUB_QUEUE,
      "5 0 * * *",
      null,
      { key: "phase2-github", tz: "UTC" },
    );
    expect(schedule).toHaveBeenCalledWith(
      SOURCE_NIP66_QUEUE,
      "15 1 * * *",
      null,
      { key: "phase2-nip66", tz: "UTC" },
    );
    expect(schedule).toHaveBeenCalledWith(
      SOURCE_NIP65_QUEUE,
      "30 2 * * *",
      null,
      { key: "phase2-nip65", tz: "UTC" },
    );
    expect(schedule).toHaveBeenCalledWith(
      SOURCE_X_QUEUE,
      "*/30 * * * *",
      null,
      { key: "phase2-x-invites", tz: "UTC" },
    );
  });

  it("creates the reliability rollup queue on its hourly cadence", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue, schedule } as unknown as PgBoss;

    await configureQueues(boss);

    expect(createQueue).toHaveBeenCalledWith(
      RELIABILITY_ROLLUP_QUEUE,
      expect.objectContaining({ retryLimit: 2 }),
    );
    expect(schedule).toHaveBeenCalledWith(
      RELIABILITY_ROLLUP_QUEUE,
      "45 * * * *",
      null,
      { key: "phase3-reliability-rollup", tz: "UTC" },
    );
  });

  it("installs the staggered 2-hour presence cadence", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue, schedule } as unknown as PgBoss;

    await configureQueues(boss);

    expect(createQueue).toHaveBeenCalledWith(
      AUTO_JOIN_QUEUE,
      expect.objectContaining({ retryLimit: 2 }),
    );
    expect(createQueue).toHaveBeenCalledWith(
      HARVEST_INVITES_QUEUE,
      expect.objectContaining({ retryLimit: 2 }),
    );
    expect(createQueue).toHaveBeenCalledWith(
      REFRESH_INVITES_QUEUE,
      expect.objectContaining({ retryLimit: 2 }),
    );
    expect(schedule).toHaveBeenCalledWith(
      REFRESH_SUMMARIES_QUEUE,
      "0 */2 * * *",
      null,
      { key: "presence-refresh-summaries", tz: "UTC" },
    );
    expect(schedule).toHaveBeenCalledWith(AUTO_JOIN_QUEUE, "15 */2 * * *", null, {
      key: "presence-auto-join",
      tz: "UTC",
    });
    expect(schedule).toHaveBeenCalledWith(
      HARVEST_INVITES_QUEUE,
      "30 */2 * * *",
      null,
      { key: "presence-harvest-invites", tz: "UTC" },
    );
    expect(schedule).toHaveBeenCalledWith(
      REFRESH_INVITES_QUEUE,
      "45 */2 * * *",
      null,
      { key: "presence-refresh-invites", tz: "UTC" },
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
