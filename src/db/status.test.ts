import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { getDiscoveryStatus } from "./status";

describe("getDiscoveryStatus", () => {
  it("returns aggregate health without candidate URLs", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          { state: "verified_buzz", count: "12" },
          { state: "rejected", count: "3" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            due_candidates: "4",
            probes_last_24_hours: "18",
            failures_last_24_hours: "2",
            last_probe_at: new Date("2026-07-29T23:00:00.000Z"),
          },
        ],
      });
    const pool = { query } as unknown as Pool;

    await expect(getDiscoveryStatus(pool)).resolves.toEqual({
      candidatesByState: {
        rejected: 3,
        verified_buzz: 12,
      },
      dueCandidates: 4,
      probesLast24Hours: 18,
      failuresLast24Hours: 2,
      lastProbeAt: "2026-07-29T23:00:00.000Z",
    });
  });
});
