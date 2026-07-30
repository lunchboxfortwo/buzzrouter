import { ACTIVITY_WINDOW_DAYS } from "./activity";

export type ActivityLabel =
  | "Very active"
  | "Active"
  | "Quiet"
  | "Limited evidence";

export interface ActivityFacts {
  activityScore: number;
  adoptionPubkeys: number;
  adoptionRepos: number;
  evidenceSufficient: boolean;
  lastVerifiedAt: string | null;
  metadataChangedAt: string | null;
  probesSuccessful: number;
  probesTotal: number;
}

/**
 * Below the evidence floor we say so, rather than publishing a small number
 * that reads like a measurement. A new listing stays discoverable without
 * being given false confidence.
 */
export function activityLabel(facts: ActivityFacts): ActivityLabel {
  if (!facts.evidenceSufficient) return "Limited evidence";
  if (facts.activityScore >= 70) return "Very active";
  if (facts.activityScore >= 40) return "Active";
  return "Quiet";
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
 * The recommendation copy IS the ranking inputs, rendered. Nothing here is
 * authored per community, so the explanation cannot drift from the score.
 */
export function explainRecommendation(facts: ActivityFacts): string[] {
  const reasons: string[] = [];

  if (facts.adoptionPubkeys > 0) {
    reasons.push(
      `Named in ${plural(
        facts.adoptionPubkeys,
        "person's",
        "people's",
      )} public relay list`,
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

  if (facts.probesTotal > 0) {
    const uptime = Math.round(
      (facts.probesSuccessful / facts.probesTotal) * 100,
    );
    reasons.push(
      `Reachable on ${uptime}% of checks over ${ACTIVITY_WINDOW_DAYS} days`,
    );
  }

  const tended = relativeDays(facts.metadataChangedAt, new Date());
  if (tended) {
    reasons.push(`Relay details updated ${tended}`);
  }

  if (reasons.length === 0) {
    reasons.push("Not enough observations yet to explain a ranking");
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
