import type { SourceType } from "../db/candidates";

export interface EligibilitySource {
  type: SourceType;
  actorPubkey?: string | null;
  observedAt: string;
}

export interface EligibilityProbe {
  probedAt: string;
  resultCode: string;
  tlsValid: boolean;
}

export interface EligibilityContext {
  latestProbe: EligibilityProbe | null;
  now?: Date;
}

export type ListingEligibilityReason =
  | "provider_intent"
  | "two_nip66_monitors"
  | "mixed_public_sources"
  | "technical_not_verified"
  | "technical_verification_stale"
  | "insufficient_public_evidence"
  | "public_evidence_stale"
  | "suppressed";

export interface ListingEligibility {
  eligible: boolean;
  independentPublicSources: number;
  reason: ListingEligibilityReason;
}

export function evaluateListingEligibility(
  state: string,
  sources: EligibilitySource[],
  context: EligibilityContext,
): ListingEligibility {
  if (state === "suppressed") {
    return result(false, 0, "suppressed");
  }

  if (state !== "verified_buzz") {
    return result(false, 0, "technical_not_verified");
  }

  const now = context.now ?? new Date();
  if (!hasFreshTechnicalVerification(context.latestProbe, now)) {
    return result(false, 0, "technical_verification_stale");
  }

  const freshSources = sources.filter((source) =>
    isFreshEvidence(source, now),
  );
  const hasProviderIntent = freshSources.some(
    (source) => source.type === "provider",
  );
  const nip66Monitors = new Set(
    freshSources
      .filter(
        (source) =>
          source.type === "nip66" && Boolean(source.actorPubkey),
      )
      .map((source) => source.actorPubkey),
  );
  const hasGitHubEvidence = freshSources.some(
    (source) => source.type === "github",
  );
  const independentPublicSources =
    (hasProviderIntent ? 1 : 0) +
    (hasGitHubEvidence ? 1 : 0) +
    nip66Monitors.size;

  if (hasProviderIntent) {
    return result(
      true,
      independentPublicSources,
      "provider_intent",
    );
  }

  if (nip66Monitors.size >= 2) {
    return result(
      true,
      independentPublicSources,
      "two_nip66_monitors",
    );
  }

  if (hasGitHubEvidence && nip66Monitors.size >= 1) {
    return result(
      true,
      independentPublicSources,
      "mixed_public_sources",
    );
  }

  const hasFreshQualifyingEvidence = freshSources.some((source) =>
    ["github", "nip66", "provider"].includes(source.type),
  );
  const hasStaleQualifyingEvidence = sources.some(
    (source) =>
      ["github", "nip66", "provider"].includes(source.type) &&
      !isFreshEvidence(source, now),
  );
  return result(
    false,
    independentPublicSources,
    hasStaleQualifyingEvidence && !hasFreshQualifyingEvidence
      ? "public_evidence_stale"
      : "insufficient_public_evidence",
  );
}

const VERIFIED_PROBE_MAX_AGE_MS = 48 * 60 * 60 * 1_000;
const NIP66_EVIDENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const INTENT_EVIDENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

function hasFreshTechnicalVerification(
  probe: EligibilityProbe | null,
  now: Date,
): boolean {
  return (
    probe?.tlsValid === true &&
    probe.resultCode === "exact_software_and_protocol" &&
    isWithinAge(probe.probedAt, now, VERIFIED_PROBE_MAX_AGE_MS)
  );
}

function isFreshEvidence(
  source: EligibilitySource,
  now: Date,
): boolean {
  if (source.type === "nip66") {
    return isWithinAge(
      source.observedAt,
      now,
      NIP66_EVIDENCE_MAX_AGE_MS,
    );
  }

  if (source.type === "github" || source.type === "provider") {
    return isWithinAge(
      source.observedAt,
      now,
      INTENT_EVIDENCE_MAX_AGE_MS,
    );
  }

  return false;
}

function isWithinAge(
  value: string,
  now: Date,
  maximumAgeMilliseconds: number,
): boolean {
  const timestamp = Date.parse(value);
  const age = now.getTime() - timestamp;

  return (
    Number.isFinite(timestamp) &&
    age >= 0 &&
    age <= maximumAgeMilliseconds
  );
}

function result(
  eligible: boolean,
  independentPublicSources: number,
  reason: ListingEligibilityReason,
): ListingEligibility {
  return {
    eligible,
    independentPublicSources,
    reason,
  };
}
