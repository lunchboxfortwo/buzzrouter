import { isIP } from "node:net";

import { normalizeRelayUrl, type NormalizedRelay } from "../discovery/normalize";
import { isFocusSlug, type FocusSlug } from "../ranking/focus";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

export class SubmissionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionValidationError";
  }
}

export function parseRelaySubmission(value: unknown): NormalizedRelay {
  if (
    typeof value !== "string" ||
    value.length > 2_048 ||
    value.trim().length === 0
  ) {
    throw new SubmissionValidationError("Relay URL is required.");
  }

  let relay: NormalizedRelay;
  try {
    relay = normalizeRelayUrl(value.trim());
  } catch {
    throw new SubmissionValidationError("Relay URL is invalid.");
  }
  if (isIP(relay.host) !== 0) {
    throw new SubmissionValidationError("Relay must use a public hostname.");
  }

  return relay;
}

export function parseContactEmail(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) {
    throw new SubmissionValidationError(
      "A valid contact email is required.",
    );
  }
  return trimmed.toLowerCase();
}

export function parseListingText(
  value: unknown,
  maxLength: number,
): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export function parseFocus(value: unknown): FocusSlug | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const focus = value.trim();
  if (!isFocusSlug(focus)) {
    throw new SubmissionValidationError("Focus is not recognized.");
  }
  return focus;
}

export function parseCategories(values: string[]): string[] {
  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
