import { isIP } from "node:net";

import { normalizeRelayUrl, type NormalizedRelay } from "../discovery/normalize";

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
