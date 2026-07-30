import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  ACTIVITY_WEIGHTS,
  rollUpActivityMetrics,
  scoreActivity,
  scoreAdoption,
  scoreLiveness,
  scoreTending,
} from "./activity";

describe("scoreAdoption", () => {
  it("returns zero without adoption evidence", () => {
    expect(scoreAdoption(0, 0)).toBe(0);
  });

  it("damps large counts so scale does not dominate", () => {
    const small = scoreAdoption(5, 0);
    const medium = scoreAdoption(50, 0);
    const large = scoreAdoption(500, 0);

    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
    expect(medium - small).toBeGreaterThan(large - medium);
  });

  it("counts code references at half the weight of relay lists", () => {
    expect(scoreAdoption(0, 4)).toBe(scoreAdoption(2, 0));
  });
});

describe("scoreLiveness", () => {
  it("is the success ratio of probes in the window", () => {
    expect(scoreLiveness(9, 10)).toBe(90);
    expect(scoreLiveness(0, 10)).toBe(0);
  });

  it("returns zero when no probes ran", () => {
    expect(scoreLiveness(0, 0)).toBe(0);
  });
});

describe("scoreTending", () => {
  const now = new Date("2026-07-30T00:00:00Z");

  it("returns zero when metadata never changed", () => {
    expect(scoreTending(null, now)).toBe(0);
  });

  it("decays as the change ages and expires past the window", () => {
    const today = scoreTending(new Date("2026-07-29T12:00:00Z"), now);
    const older = scoreTending(new Date("2026-07-16T00:00:00Z"), now);
    const expired = scoreTending(new Date("2026-06-01T00:00:00Z"), now);

    expect(today).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(0);
    expect(expired).toBe(0);
  });
});

describe("scoreActivity", () => {
  const now = new Date("2026-07-30T00:00:00Z");

  it("weights adoption most heavily", () => {
    expect(ACTIVITY_WEIGHTS.adoption).toBeGreaterThan(
      ACTIVITY_WEIGHTS.liveness,
    );
    expect(ACTIVITY_WEIGHTS.liveness).toBeGreaterThan(
      ACTIVITY_WEIGHTS.tending,
    );
  });

  it("marks evidence insufficient below the floor", () => {
    const scores = scoreActivity(
      {
        adoptionPubkeys: 1,
        adoptionRepos: 0,
        metadataChangedAt: null,
        probesSuccessful: 2,
        probesTotal: 2,
      },
      now,
    );

    expect(scores.evidenceSufficient).toBe(false);
  });

  it("marks evidence sufficient once both floors are met", () => {
    const scores = scoreActivity(
      {
        adoptionPubkeys: 12,
        adoptionRepos: 2,
        metadataChangedAt: new Date("2026-07-28T00:00:00Z"),
        probesSuccessful: 29,
        probesTotal: 30,
      },
      now,
    );

    expect(scores.evidenceSufficient).toBe(true);
    expect(scores.activityScore).toBeGreaterThan(0);
    expect(scores.activityScore).toBeLessThanOrEqual(100);
  });

  it("never exceeds the score bounds", () => {
    const scores = scoreActivity(
      {
        adoptionPubkeys: 100_000,
        adoptionRepos: 100_000,
        metadataChangedAt: now,
        probesSuccessful: 50,
        probesTotal: 50,
      },
      now,
    );

    expect(scores.activityScore).toBeLessThanOrEqual(100);
    expect(scores.adoptionScore).toBeLessThanOrEqual(100);
  });
});

describe("rollUpActivityMetrics", () => {
  it("counts distinct relay-list pubkeys and upserts by candidate", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 3 });
    const pool = { query } as unknown as Pool;

    const result = await rollUpActivityMetrics(pool);

    expect(result).toEqual({ candidatesUpdated: 3 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("count(DISTINCT source_actor_pubkey)");
    expect(sql).toContain("source_type = 'nip65'");
    expect(sql).toContain("ON CONFLICT (candidate_id) DO UPDATE");
    expect(params[0]).toBe(30);
  });
});
