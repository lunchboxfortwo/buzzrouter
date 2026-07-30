import { normalizeRelayUrl } from "./normalize";
import { sanitizeSourceLocator } from "./source-locator";

export interface ReviewedRelayEntry {
  url: string;
  sourceLocator?: string;
}

export interface ReviewedRelaySeed {
  relays: ReviewedRelayEntry[];
}

export function parseReviewedRelaySeed(contents: string): ReviewedRelaySeed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Reviewed relay file is not valid JSON.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("relays" in parsed) ||
    !Array.isArray(parsed.relays)
  ) {
    throw new Error("Reviewed relay file must contain a relays array.");
  }

  const relays = parsed.relays.map(parseEntry);
  return { relays };
}

export function addReviewedRelay(
  seed: ReviewedRelaySeed,
  relayInput: string,
  sourceLocatorInput?: string,
): ReviewedRelaySeed {
  const relay = normalizeRelayUrl(relayInput);
  const sourceLocator =
    sanitizeSourceLocator(sourceLocatorInput) ?? undefined;
  const candidate: ReviewedRelayEntry = {
    url: relay.canonicalRelayUrl,
    ...(sourceLocator ? { sourceLocator } : {}),
  };

  const deduplicationKey = entryKey(candidate);
  const relays = [
    ...seed.relays.filter((entry) => entryKey(entry) !== deduplicationKey),
    candidate,
  ].sort((left, right) => entryKey(left).localeCompare(entryKey(right)));

  return { relays };
}

export function serializeReviewedRelaySeed(seed: ReviewedRelaySeed): string {
  return `${JSON.stringify(seed, null, 2)}\n`;
}

function parseEntry(entry: unknown): ReviewedRelayEntry {
  if (
    typeof entry !== "object" ||
    entry === null ||
    !("url" in entry) ||
    typeof entry.url !== "string"
  ) {
    throw new Error(
      "Reviewed relay entries must contain URL strings.",
    );
  }

  const rawSourceLocator =
    "sourceLocator" in entry ? entry.sourceLocator : undefined;
  if (
    rawSourceLocator !== undefined &&
    typeof rawSourceLocator !== "string"
  ) {
    throw new Error(
      "Reviewed relay entries must contain URL strings.",
    );
  }

  const normalized = normalizeRelayUrl(entry.url);
  const sourceLocator =
    sanitizeSourceLocator(rawSourceLocator) ?? undefined;

  return {
    url: normalized.canonicalRelayUrl,
    ...(sourceLocator ? { sourceLocator } : {}),
  };
}

function entryKey(entry: ReviewedRelayEntry): string {
  return `${entry.url}\u0000${entry.sourceLocator ?? ""}`;
}
