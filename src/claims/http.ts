import { apiErrorResponse } from "../http/api-error";
import {
  authenticateJsonRequest,
  type AuthenticatedRequestBody,
} from "../http/nostr-auth";
import { ClaimError } from "./errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export { authenticateJsonRequest, type AuthenticatedRequestBody };

export function claimErrorResponse(error: unknown): Response {
  return apiErrorResponse(
    error,
    new ClaimError(
      "challenge_failed",
      "The claim request could not be completed.",
      500,
    ),
  );
}

export function requireUuid(value: unknown): string {
  if (!isUuid(value)) {
    throw new ClaimError("invalid_input", "Identifier is invalid.");
  }
  return value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function requireObject(
  value: unknown,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ClaimError("invalid_input", "Request body is invalid.");
  }
  return value as Record<string, unknown>;
}
