import type { Nip11Document } from "./nip11";

export const BUZZ_CLASSIFIER_VERSION = 1;
export const BUZZ_SOFTWARE_URL = "https://github.com/block/buzz";

export type BuzzClassification =
  | {
      state: "verified_buzz";
      reason: "exact_software_and_protocol";
      classifierVersion: number;
    }
  | {
      state: "probable_buzz";
      reason: "buzz_metadata_without_canonical_software";
      classifierVersion: number;
    }
  | {
      state: "rejected";
      reason:
        | "websocket_unavailable"
        | "different_software"
        | "insufficient_buzz_evidence";
      classifierVersion: number;
    };

export function classifyBuzzRelay(
  nip11: Nip11Document,
  websocketOpened: boolean,
): BuzzClassification {
  if (!websocketOpened) {
    return classification("rejected", "websocket_unavailable");
  }

  const hasBuzzNips =
    nip11.supportedNips.includes(29) && nip11.supportedNips.includes(42);
  const software = normalizeSoftwareUrl(nip11.software);

  if (software === BUZZ_SOFTWARE_URL && hasBuzzNips) {
    return classification("verified_buzz", "exact_software_and_protocol");
  }

  if (software && software !== BUZZ_SOFTWARE_URL) {
    return classification("rejected", "different_software");
  }

  const restricted =
    nip11.limitation.authRequired === true ||
    nip11.limitation.restrictedWrites === true;

  if (nip11.name === "Buzz Relay" && hasBuzzNips && restricted) {
    return classification(
      "probable_buzz",
      "buzz_metadata_without_canonical_software",
    );
  }

  return classification("rejected", "insufficient_buzz_evidence");
}

export function hasCanonicalBuzzSoftware(
  software: string | undefined,
): boolean {
  return normalizeSoftwareUrl(software) === BUZZ_SOFTWARE_URL;
}

function normalizeSoftwareUrl(software: string | undefined): string | null {
  if (!software) {
    return null;
  }

  try {
    const parsed = new URL(software);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return software;
    }

    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return software;
  }
}

function classification<
  State extends BuzzClassification["state"],
  Reason extends Extract<BuzzClassification, { state: State }>["reason"],
>(state: State, reason: Reason): Extract<BuzzClassification, { state: State }> {
  return {
    state,
    reason,
    classifierVersion: BUZZ_CLASSIFIER_VERSION,
  } as Extract<BuzzClassification, { state: State }>;
}
