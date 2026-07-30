import { describe, expect, it } from "vitest";

import {
  evaluateListingEligibility,
  type EligibilitySource,
} from "./listing-eligibility";

const now = new Date("2026-07-30T12:00:00.000Z");
const recent = "2026-07-30T10:00:00.000Z";
const latestVerifiedProbe = {
  probedAt: recent,
  resultCode: "exact_software_and_protocol",
  tlsValid: true,
};

function evaluate(
  sources: Array<Omit<EligibilitySource, "observedAt">>,
  state = "verified_buzz",
) {
  return evaluateListingEligibility(
    state,
    sources.map((source) => ({ ...source, observedAt: recent })),
    { latestProbe: latestVerifiedProbe, now },
  );
}

describe("evaluateListingEligibility", () => {
  it("accepts two independent NIP-66 monitor keys", () => {
    expect(
      evaluate([
        { type: "nip66", actorPubkey: "a".repeat(64) },
        { type: "nip66", actorPubkey: "b".repeat(64) },
      ]),
    ).toEqual({
      eligible: true,
      independentPublicSources: 2,
      reason: "two_nip66_monitors",
    });
  });

  it("accepts GitHub plus one signed monitor", () => {
    expect(
      evaluate([
        { type: "github" },
        { type: "nip66", actorPubkey: "a".repeat(64) },
      ]),
    ).toMatchObject({
      eligible: true,
      reason: "mixed_public_sources",
    });
  });

  it("does not count NIP-65 hints toward publication", () => {
    expect(
      evaluate([
        { type: "nip65", actorPubkey: "a".repeat(64) },
        { type: "nip65", actorPubkey: "b".repeat(64) },
      ]),
    ).toEqual({
      eligible: false,
      independentPublicSources: 0,
      reason: "insufficient_public_evidence",
    });
  });

  it("does not count duplicate reports from one monitor twice", () => {
    expect(
      evaluate([
        { type: "nip66", actorPubkey: "a".repeat(64) },
        { type: "nip66", actorPubkey: "a".repeat(64) },
      ]),
    ).toMatchObject({
      eligible: false,
      independentPublicSources: 1,
    });
  });

  it("requires direct technical verification", () => {
    expect(evaluate([{ type: "provider" }], "probable_buzz")).toMatchObject({
      eligible: false,
      reason: "technical_not_verified",
    });
  });

  it("rejects a stale or failed latest direct probe", () => {
    const sources = [
      {
        actorPubkey: "a".repeat(64),
        observedAt: recent,
        type: "nip66" as const,
      },
      {
        actorPubkey: "b".repeat(64),
        observedAt: recent,
        type: "nip66" as const,
      },
    ];

    expect(
      evaluateListingEligibility("verified_buzz", sources, {
        latestProbe: {
          ...latestVerifiedProbe,
          probedAt: "2026-07-27T10:00:00.000Z",
        },
        now,
      }),
    ).toMatchObject({
      eligible: false,
      reason: "technical_verification_stale",
    });
    expect(
      evaluateListingEligibility("verified_buzz", sources, {
        latestProbe: {
          probedAt: recent,
          resultCode: "network_failed",
          tlsValid: false,
        },
        now,
      }),
    ).toMatchObject({
      eligible: false,
      reason: "technical_verification_stale",
    });
  });

  it("rejects stale public evidence", () => {
    expect(
      evaluateListingEligibility(
        "verified_buzz",
        [
          {
            actorPubkey: "a".repeat(64),
            observedAt: "2026-07-01T00:00:00.000Z",
            type: "nip66",
          },
          {
            actorPubkey: "b".repeat(64),
            observedAt: "2026-07-01T00:00:00.000Z",
            type: "nip66",
          },
        ],
        { latestProbe: latestVerifiedProbe, now },
      ),
    ).toMatchObject({
      eligible: false,
      reason: "public_evidence_stale",
    });
  });
});
