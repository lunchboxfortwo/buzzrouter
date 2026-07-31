import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  ADOPTION_ENABLED,
  CORROBORATION_SATURATION,
  EVIDENCE_FLOOR,
  RELIABILITY_WEIGHTS,
  rollUpReliabilityMetrics,
  scoreAdoption,
  scoreCorroboration,
  scoreReliability,
  scoreTending,
  scoreUptime,
} from "./reliability";

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

describe("scoreUptime", () => {
  it("is the success ratio of probes in the window", () => {
    expect(scoreUptime(9, 10)).toBe(90);
    expect(scoreUptime(0, 10)).toBe(0);
  });

  it("returns zero when no probes ran", () => {
    expect(scoreUptime(0, 0)).toBe(0);
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

describe("scoreCorroboration", () => {
  it("returns zero without any corroborating sources", () => {
    expect(scoreCorroboration(0)).toBe(0);
  });

  it("damps large counts so scale does not dominate", () => {
    const one = scoreCorroboration(1);
    const three = scoreCorroboration(3);
    const six = scoreCorroboration(6);

    expect(one).toBeLessThan(three);
    expect(three).toBeLessThan(six);
  });

  it("saturates at the configured source count", () => {
    expect(scoreCorroboration(CORROBORATION_SATURATION)).toBe(100);
    expect(scoreCorroboration(CORROBORATION_SATURATION * 10)).toBe(100);
  });
});

describe("RELIABILITY_WEIGHTS", () => {
  it("sums to one across the live signals while adoption stays disabled", () => {
    expect(ADOPTION_ENABLED).toBe(false);
    expect(RELIABILITY_WEIGHTS.adoption).toBe(0);
    expect(
      RELIABILITY_WEIGHTS.uptime +
        RELIABILITY_WEIGHTS.tending +
        RELIABILITY_WEIGHTS.corroboration +
        RELIABILITY_WEIGHTS.adoption,
    ).toBeCloseTo(1);
  });
});

describe("scoreReliability", () => {
  const now = new Date("2026-07-30T00:00:00Z");

  it("marks evidence insufficient below the probe floor", () => {
    const scores = scoreReliability(
      {
        adoptionPubkeys: 0,
        adoptionRepos: 0,
        corroborationSources: 1,
        metadataChangedAt: null,
        probesSuccessful: 2,
        probesTotal: 2,
      },
      now,
    );

    expect(scores.evidenceSufficient).toBe(false);
  });

  it("marks evidence sufficient once the probe floor is met, without needing adoption", () => {
    const scores = scoreReliability(
      {
        adoptionPubkeys: 0,
        adoptionRepos: 0,
        corroborationSources: 3,
        metadataChangedAt: new Date("2026-07-28T00:00:00Z"),
        probesSuccessful: 29,
        probesTotal: 30,
      },
      now,
    );

    expect(scores.evidenceSufficient).toBe(true);
    expect(scores.reliabilityScore).toBeGreaterThan(0);
    expect(scores.reliabilityScore).toBeLessThanOrEqual(100);
  });

  it("ignores adoption inputs entirely while ADOPTION_ENABLED is false", () => {
    const withoutAdoption = scoreReliability(
      {
        adoptionPubkeys: 0,
        adoptionRepos: 0,
        corroborationSources: 3,
        metadataChangedAt: null,
        probesSuccessful: 30,
        probesTotal: 30,
      },
      now,
    );
    const withAdoption = scoreReliability(
      {
        adoptionPubkeys: 100_000,
        adoptionRepos: 100_000,
        corroborationSources: 3,
        metadataChangedAt: null,
        probesSuccessful: 30,
        probesTotal: 30,
      },
      now,
    );

    expect(withAdoption.adoptionScore).toBeGreaterThan(0);
    expect(withAdoption.reliabilityScore).toBe(withoutAdoption.reliabilityScore);
  });

  it("never exceeds the score bounds", () => {
    const scores = scoreReliability(
      {
        adoptionPubkeys: 100_000,
        adoptionRepos: 100_000,
        corroborationSources: 100,
        metadataChangedAt: now,
        probesSuccessful: 50,
        probesTotal: 50,
      },
      now,
    );

    expect(scores.reliabilityScore).toBeLessThanOrEqual(100);
    expect(scores.corroborationScore).toBeLessThanOrEqual(100);
  });
});

describe("EVIDENCE_FLOOR", () => {
  it("no longer requires adoption pubkeys, which NIP-65 cannot supply today", () => {
    expect(EVIDENCE_FLOOR).toEqual({ probesTotal: 5 });
  });
});

describe("rollUpReliabilityMetrics", () => {
  it("computes corroboration from distinct source types and upserts by candidate", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 3 });
    const pool = { query } as unknown as Pool;

    const result = await rollUpReliabilityMetrics(pool);

    expect(result).toEqual({ candidatesUpdated: 3 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("count(DISTINCT source_type) AS sources");
    expect(sql).toContain("INSERT INTO community_reliability_metrics");
    expect(sql).toContain("ON CONFLICT (candidate_id) DO UPDATE");
    expect(params[0]).toBe(30);
  });
});
