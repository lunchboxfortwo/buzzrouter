import { RELIABILITY_WINDOW_DAYS, ADOPTION_ENABLED } from "./reliability";

export type ReliabilityLabel = "Live" | "Intermittent" | "Stale" | "New";

export interface ReliabilityFacts {
  adoptionPubkeys: number;
  adoptionRepos: number;
  evidenceSufficient: boolean;
  lastVerifiedAt: string | null;
  metadataChangedAt: string | null;
  monitorCount: number;
  probesSuccessful: number;
  probesTotal: number;
  reliabilityScore: number;
}

const STALE_AFTER_MS = 48 * 60 * 60 * 1_000;

/**
 * Below the evidence floor we say so, rather than publishing a label that
 * reads like a measurement. A new listing stays discoverable without being
 * given false confidence.
 */
export function reliabilityLabel(
  facts: ReliabilityFacts,
  now: Date = new Date(),
): ReliabilityLabel {
  if (!facts.evidenceSufficient) return "New";

  const lastVerified = facts.lastVerifiedAt ? new Date(facts.lastVerifiedAt) : null;
  if (
    !lastVerified ||
    Number.isNaN(lastVerified.getTime()) ||
    now.getTime() - lastVerified.getTime() > STALE_AFTER_MS
  ) {
    return "Stale";
  }

  const uptime = facts.probesTotal > 0
    ? facts.probesSuccessful / facts.probesTotal
    : 0;
  if (uptime >= 0.9) return "Live";
  return "Intermittent";
}

const plural = (count: number, singular: string, pluralForm: string): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;

function relativeDays(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor(
    (now.getTime() - then.getTime()) / (24 * 60 * 60 * 1_000),
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  return `${Math.floor(days / 7)} weeks ago`;
}

/**
 * The explanation IS the ranking inputs, rendered. Nothing here is authored
 * per community, so the copy cannot drift from the score. Only live signals
 * render today; the adoption line stays in the code, gated dark, so it lights
 * up automatically once NIP-65 adoption is enabled.
 */
export function explainChecks(facts: ReliabilityFacts): string[] {
  const reasons: string[] = [];

  if (facts.probesTotal > 0) {
    const uptime = Math.round(
      (facts.probesSuccessful / facts.probesTotal) * 100,
    );
    reasons.push(
      `Reachable on ${uptime}% of checks over ${RELIABILITY_WINDOW_DAYS} days`,
    );
  }

  if (facts.adoptionRepos > 0) {
    reasons.push(
      `Referenced in ${plural(
        facts.adoptionRepos,
        "public code file",
        "public code files",
      )}`,
    );
  }

  if (facts.monitorCount > 0) {
    reasons.push(
      `Seen by ${plural(facts.monitorCount, "independent monitor", "independent monitors")}`,
    );
  }

  const tended = relativeDays(facts.metadataChangedAt, new Date());
  if (tended) {
    reasons.push(`Relay details updated ${tended}`);
  }

  if (ADOPTION_ENABLED && facts.adoptionPubkeys > 0) {
    reasons.push(
      `Named in ${plural(
        facts.adoptionPubkeys,
        "person's",
        "people's",
      )} public relay list`,
    );
  }

  if (reasons.length === 0) {
    reasons.push("Not enough checks yet to describe this relay");
  }

  return reasons;
}

/**
 * "About" always comes from the relay's own published metadata. BuzzRouter
 * never writes a description on a community's behalf.
 */
export function aboutText(description: string | null): {
  source: "relay-metadata" | "none";
  text: string;
} {
  const trimmed = (description ?? "").trim();
  if (!trimmed) {
    return {
      source: "none",
      text: "This relay has not published a description yet.",
    };
  }
  return { source: "relay-metadata", text: trimmed };
}

/**
 * "Current work" is operator-authored and therefore gated on a verified claim.
 * Until then we show only what was observed, never an invented summary.
 */
export function currentWork(input: {
  claimed: boolean;
  operatorStatement: string | null;
  softwareVersion: string | null;
  supportedNips: number[];
}): { kind: "observed" | "operator" | "none"; text: string } | null {
  if (input.claimed && input.operatorStatement?.trim()) {
    return { kind: "operator", text: input.operatorStatement.trim() };
  }

  const observed: string[] = [];
  if (input.softwareVersion) {
    observed.push(`running Buzz ${input.softwareVersion}`);
  }
  if (input.supportedNips.length > 0) {
    observed.push(`supporting ${input.supportedNips.length} protocol features`);
  }

  if (observed.length === 0) return null;
  return {
    kind: "observed",
    text: `Recently observed ${observed.join(", ")}.`,
  };
}
