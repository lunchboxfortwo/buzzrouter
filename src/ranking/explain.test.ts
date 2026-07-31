import { describe, expect, it } from "vitest";

import {
  aboutText,
  currentWork,
  explainChecks,
  reliabilityLabel,
  type ReliabilityFacts,
} from "./explain";

const facts = (overrides: Partial<ReliabilityFacts> = {}): ReliabilityFacts => ({
  adoptionPubkeys: 0,
  adoptionRepos: 2,
  evidenceSufficient: true,
  lastVerifiedAt: "2026-07-30T00:00:00Z",
  metadataChangedAt: null,
  monitorCount: 3,
  probesSuccessful: 30,
  probesTotal: 30,
  reliabilityScore: 80,
  ...overrides,
});

describe("reliabilityLabel", () => {
  const now = new Date("2026-07-30T00:00:00Z");

  it("says New below the evidence floor, whatever else is true", () => {
    expect(
      reliabilityLabel(
        facts({ evidenceSufficient: false, probesSuccessful: 30, probesTotal: 30 }),
        now,
      ),
    ).toBe("New");
  });

  it("says Stale once the last successful probe is older than 48 hours", () => {
    expect(
      reliabilityLabel(facts({ lastVerifiedAt: "2026-07-27T00:00:00Z" }), now),
    ).toBe("Stale");
  });

  it("says Live within 48 hours of the last successful probe", () => {
    expect(
      reliabilityLabel(facts({ lastVerifiedAt: "2026-07-29T12:00:00Z" }), now),
    ).toBe("Live");
  });

  it("says Stale when there is no last-verified timestamp at all", () => {
    expect(reliabilityLabel(facts({ lastVerifiedAt: null }), now)).toBe("Stale");
  });

  it("says Live at or above 90% uptime within the freshness window", () => {
    expect(
      reliabilityLabel(facts({ probesSuccessful: 30, probesTotal: 30 }), now),
    ).toBe("Live");
    expect(
      reliabilityLabel(facts({ probesSuccessful: 27, probesTotal: 30 }), now),
    ).toBe("Live");
  });

  it("says Intermittent below 90% uptime within the freshness window", () => {
    expect(
      reliabilityLabel(facts({ probesSuccessful: 20, probesTotal: 30 }), now),
    ).toBe("Intermittent");
  });
});

describe("explainChecks", () => {
  it("renders the ranking inputs rather than authored copy", () => {
    const reasons = explainChecks(facts());

    expect(reasons[0]).toBe("Reachable on 100% of checks over 30 days");
    expect(reasons).toContain("Referenced in 2 public code files");
    expect(reasons).toContain("Seen by 3 independent monitors");
  });

  it("uses singular wording for a single observation", () => {
    const reasons = explainChecks(
      facts({ adoptionRepos: 1, monitorCount: 1 }),
    );

    expect(reasons).toContain("Referenced in 1 public code file");
    expect(reasons).toContain("Seen by 1 independent monitor");
  });

  it("omits any line whose count is zero", () => {
    const reasons = explainChecks(
      facts({ adoptionRepos: 0, monitorCount: 0, probesTotal: 0, probesSuccessful: 0 }),
    );

    expect(reasons).toEqual(["Not enough checks yet to describe this relay"]);
  });

  it("includes the metadata-tended line only when metadata has changed", () => {
    const withChange = explainChecks(
      facts({ metadataChangedAt: new Date().toISOString() }),
    );
    const withoutChange = explainChecks(facts({ metadataChangedAt: null }));

    expect(withChange.some((reason) => reason.startsWith("Relay details updated"))).toBe(true);
    expect(withoutChange.some((reason) => reason.startsWith("Relay details updated"))).toBe(false);
  });

  it("keeps the adoption line dark even with adoption pubkeys, because ADOPTION_ENABLED is false", () => {
    const reasons = explainChecks(facts({ adoptionPubkeys: 41 }));

    expect(reasons.some((reason) => reason.includes("public relay list"))).toBe(false);
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
