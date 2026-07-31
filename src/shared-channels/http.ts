import { apiErrorResponse, ApiError } from "../http/api-error";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sharedChannelErrorResponse(error: unknown): Response {
  if (!(error instanceof ApiError)) {
    console.error("Shared-channel request failed", error);
  }
  return apiErrorResponse(
    error,
    new ApiError(
      "shared_channel_failed",
      "The shared-channel request could not be completed.",
      500,
    ),
  );
}

export function requireObject(
  value: unknown,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ApiError("invalid_input", "Request body is invalid.");
  }
  return value as Record<string, unknown>;
}

export function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ApiError("invalid_input", "Identifier is invalid.");
  }
  return value;
}

export function requireText(
  value: unknown,
  maxLength: number,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new ApiError("invalid_input", `${label} is invalid.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new ApiError("invalid_input", `${label} is invalid.`);
  }
  return normalized;
}
