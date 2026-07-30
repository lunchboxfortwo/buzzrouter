import { describe, expect, it } from "vitest";

import {
  aboutText,
  activityLabel,
  currentWork,
  explainRecommendation,
  type ActivityFacts,
} from "./explain";

const facts = (overrides: Partial<ActivityFacts> = {}): ActivityFacts => ({
  activityScore: 80,
  adoptionPubkeys: 41,
  adoptionRepos: 2,
  evidenceSufficient: true,
  lastVerifiedAt: "2026-07-30T00:00:00Z",
  metadataChangedAt: null,
  probesSuccessful: 30,
  probesTotal: 30,
  ...overrides,
});

describe("activityLabel", () => {
  it("says limited evidence below the floor, whatever the score", () => {
    expect(
      activityLabel(facts({ activityScore: 95, evidenceSufficient: false })),
    ).toBe("Limited evidence");
  });

  it("maps scores to plain-language bands", () => {
    expect(activityLabel(facts({ activityScore: 80 }))).toBe("Very active");
    expect(activityLabel(facts({ activityScore: 55 }))).toBe("Active");
    expect(activityLabel(facts({ activityScore: 12 }))).toBe("Quiet");
  });
});

describe("explainRecommendation", () => {
  it("renders the ranking inputs rather than authored copy", () => {
    const reasons = explainRecommendation(facts());

    expect(reasons[0]).toBe("Named in 41 people's public relay list");
    expect(reasons).toContain("Referenced in 2 public code files");
    expect(reasons).toContain("Reachable on 100% of checks over 30 days");
  });

  it("uses singular wording for a single observation", () => {
    const reasons = explainRecommendation(
      facts({ adoptionPubkeys: 1, adoptionRepos: 1 }),
    );

    expect(reasons[0]).toBe("Named in 1 person's public relay list");
    expect(reasons).toContain("Referenced in 1 public code file");
  });

  it("admits when there is nothing to explain", () => {
    const reasons = explainRecommendation(
      facts({
        adoptionPubkeys: 0,
        adoptionRepos: 0,
        probesSuccessful: 0,
        probesTotal: 0,
      }),
    );

    expect(reasons).toEqual([
      "Not enough observations yet to explain a ranking",
    ]);
  });
});

describe("aboutText", () => {
  it("uses the relay's own published description", () => {
    expect(aboutText("  A room for builders.  ")).toEqual({
      source: "relay-metadata",
      text: "A room for builders.",
    });
  });

  it("never invents a description", () => {
    expect(aboutText(null).source).toBe("none");
    expect(aboutText("   ").source).toBe("none");
  });
});

describe("currentWork", () => {
  it("prefers an operator statement once the listing is claimed", () => {
    const result = currentWork({
      claimed: true,
      operatorStatement: "Shipping a shared evaluation suite.",
      softwareVersion: "0.2.0",
      supportedNips: [1, 11],
    });

    expect(result).toEqual({
      kind: "operator",
      text: "Shipping a shared evaluation suite.",
    });
  });

  it("falls back to observed facts when unclaimed", () => {
    const result = currentWork({
      claimed: false,
      operatorStatement: "ignored until claimed",
      softwareVersion: "0.2.0",
      supportedNips: [1, 11, 17],
    });

    expect(result?.kind).toBe("observed");
    expect(result?.text).toContain("Buzz 0.2.0");
    expect(result?.text).toContain("3 protocol features");
  });

  it("renders nothing when there is nothing observed", () => {
    expect(
      currentWork({
        claimed: false,
        operatorStatement: null,
        softwareVersion: null,
        supportedNips: [],
      }),
    ).toBeNull();
  });
});
