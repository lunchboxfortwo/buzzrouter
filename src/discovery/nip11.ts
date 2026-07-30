import { createHash } from "node:crypto";

import { DiscoveryError } from "./errors";

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
