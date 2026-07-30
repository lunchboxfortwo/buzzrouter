import { ClaimError } from "./errors";

export const CLAIM_METHODS = [
  "dns_txt",
  "http_file",
  "hosted_icon",
] as const;
export type ClaimMethod = (typeof CLAIM_METHODS)[number];

export const JOIN_MODES = [
  "invite_required",
  "request_invite",
  "public_link",
] as const;
export type JoinMode = (typeof JOIN_MODES)[number];

export interface ListingMetadataInput {
  categories: string[];
  description: string;
  displayName: string;
  joinMode: JoinMode;
  joinUrl: string | null;
  slug: string;
  visibility: "internal" | "public";
}

const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export function parseClaimMethod(value: unknown): ClaimMethod {
  if (
    typeof value !== "string" ||
    !CLAIM_METHODS.includes(value as ClaimMethod)
  ) {
    throw new ClaimError(
      "invalid_input",
      "Claim method is invalid.",
    );
  }

  return value as ClaimMethod;
}

export function parseListingMetadata(value: unknown): ListingMetadataInput {
  if (!isRecord(value)) {
    throw invalidMetadata();
  }

  const displayName = boundedText(value.displayName, 2, 80);
  const description = boundedText(value.description, 1, 500);
  const slug =
    typeof value.slug === "string" ? value.slug.trim().toLowerCase() : "";
  if (!SLUG_PATTERN.test(slug)) {
    throw invalidMetadata();
  }

  if (
    !Array.isArray(value.categories) ||
    value.categories.length > 5 ||
    value.categories.some(
      (category) =>
        typeof category !== "string" ||
        !CATEGORY_PATTERN.test(category),
    )
  ) {
    throw invalidMetadata();
  }
  const categories = [...new Set(value.categories as string[])];

  if (
    typeof value.joinMode !== "string" ||
    !JOIN_MODES.includes(value.joinMode as JoinMode)
  ) {
    throw invalidMetadata();
  }
  const joinMode = value.joinMode as JoinMode;
  const joinUrl = parseJoinUrl(value.joinUrl, joinMode);
  const visibility =
    value.visibility === "internal" || value.visibility === "public"
      ? value.visibility
      : null;
  if (!visibility) {
    throw invalidMetadata();
  }

  return {
    categories,
    description,
    displayName,
    joinMode,
    joinUrl,
    slug,
    visibility,
  };
}

function parseJoinUrl(value: unknown, joinMode: JoinMode): string | null {
  if (joinMode === "invite_required") {
    if (value !== null && value !== undefined && value !== "") {
      throw invalidMetadata();
    }
    return null;
  }
  if (typeof value !== "string" || value.length > 2_048) {
    throw invalidMetadata();
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password
    ) {
      throw invalidMetadata();
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof ClaimError) {
      throw error;
    }
    throw invalidMetadata();
  }
}

function boundedText(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string") {
    throw invalidMetadata();
  }

  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw invalidMetadata();
  }
  return normalized;
}

function invalidMetadata(): ClaimError {
  return new ClaimError(
    "invalid_input",
    "Listing metadata is invalid.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
