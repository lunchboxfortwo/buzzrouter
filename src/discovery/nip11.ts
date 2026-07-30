import { createHash } from "node:crypto";

import { DiscoveryError } from "./errors";

const MAX_PUBLIC_ICON_BYTES = 256 * 1024;

export interface Nip11Document {
  name?: string;
  description?: string;
  icon?: string;
  software?: string;
  version?: string;
  supportedNips: number[];
  relaySelfPubkey?: string;
  limitation: {
    authRequired?: boolean;
    restrictedWrites?: boolean;
  };
}

export interface PublicRelayIcon {
  bytes: Buffer;
  contentHash: string;
  contentType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
}

export function parseNip11Document(value: unknown): Nip11Document {
  if (!isRecord(value)) {
    throw new DiscoveryError(
      "invalid_nip11",
      "Relay information is not a JSON object.",
    );
  }

  const supportedNips = value.supported_nips;
  if (
    supportedNips !== undefined &&
    (!Array.isArray(supportedNips) ||
      supportedNips.some(
        (nip) => !Number.isInteger(nip) || (nip as number) < 0,
      ))
  ) {
    throw new DiscoveryError(
      "invalid_nip11",
      "Relay supported_nips is invalid.",
    );
  }

  const limitation = value.limitation;
  if (limitation !== undefined && !isRecord(limitation)) {
    throw new DiscoveryError(
      "invalid_nip11",
      "Relay limitation metadata is invalid.",
    );
  }

  return {
    name: optionalString(value.name, "name"),
    description: optionalString(value.description, "description"),
    icon: optionalString(value.icon, "icon"),
    software: optionalString(value.software, "software"),
    version: optionalString(value.version, "version"),
    supportedNips: (supportedNips as number[] | undefined) ?? [],
    relaySelfPubkey: optionalString(value.self, "self"),
    limitation: {
      authRequired: optionalBoolean(limitation?.auth_required, "auth_required"),
      restrictedWrites: optionalBoolean(
        limitation?.restricted_writes,
        "restricted_writes",
      ),
    },
  };
}

export function hashPublicIcon(icon: string | undefined): string | null {
  if (!icon) {
    return null;
  }

  return createHash("sha256").update(icon).digest("hex");
}

export function parsePublicIconDataUri(
  icon: string | undefined,
): PublicRelayIcon | null {
  if (!icon) {
    return null;
  }

  const match =
    /^data:(image\/(?:gif|jpeg|png|webp));base64,([a-z0-9+/]+={0,2})$/i.exec(
      icon,
    );
  if (!match) {
    return null;
  }

  const contentType = match[1].toLowerCase() as PublicRelayIcon["contentType"];
  const payload = match[2];
  if (payload.length % 4 === 1) {
    return null;
  }

  const bytes = Buffer.from(payload, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_PUBLIC_ICON_BYTES ||
    !hasExpectedImageSignature(contentType, bytes)
  ) {
    return null;
  }

  return {
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    contentType,
  };
}

function hasExpectedImageSignature(
  contentType: PublicRelayIcon["contentType"],
  bytes: Buffer,
): boolean {
  switch (contentType) {
    case "image/gif":
      return (
        bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
        bytes.subarray(0, 6).toString("ascii") === "GIF89a"
      );
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    case "image/webp":
      return (
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP"
      );
  }
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new DiscoveryError(
      "invalid_nip11",
      `Relay ${field} metadata is invalid.`,
    );
  }

  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new DiscoveryError(
      "invalid_nip11",
      `Relay ${field} metadata is invalid.`,
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
