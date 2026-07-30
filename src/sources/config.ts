import { resolvePublicAddresses } from "../discovery/network-policy";
import { normalizeRelayUrl } from "../discovery/normalize";
import { SourceAdapterError } from "./errors";

const HEX_PUBKEY = /^[a-f0-9]{64}$/;

export function isSourceEnabled(name: string): boolean {
  return process.env[name] === "true";
}

export function parseCsv(
  value: string | undefined,
  options: {
    field: string;
    maximum: number;
    minimum?: number;
  },
): string[] {
  const values = [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  const minimum = options.minimum ?? 0;

  if (values.length < minimum || values.length > options.maximum) {
    throw new SourceAdapterError(
      "invalid_configuration",
      `${options.field} must contain ${minimum}-${options.maximum} values.`,
    );
  }

  return values;
}

export function parsePubkeys(
  value: string | undefined,
  options: {
    field: string;
    maximum: number;
    minimum?: number;
  },
): string[] {
  const pubkeys = [
    ...new Set(
      parseCsv(value, options).map((pubkey) => pubkey.toLowerCase()),
    ),
  ];
  const minimum = options.minimum ?? 0;

  if (pubkeys.some((pubkey) => !HEX_PUBKEY.test(pubkey))) {
    throw new SourceAdapterError(
      "invalid_configuration",
      `${options.field} contains an invalid public key.`,
    );
  }
  if (pubkeys.length < minimum || pubkeys.length > options.maximum) {
    throw new SourceAdapterError(
      "invalid_configuration",
      `${options.field} must contain ${minimum}-${options.maximum} values.`,
    );
  }

  return pubkeys;
}

export async function validateSourceRelays(
  relayInputs: string[],
): Promise<string[]> {
  const relays: string[] = [];

  for (const input of relayInputs) {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new SourceAdapterError(
        "invalid_configuration",
        "Source relay URL is invalid.",
      );
    }

    if (
      parsed.protocol !== "wss:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new SourceAdapterError(
        "invalid_configuration",
        "Source relays must use credential-free WSS URLs.",
      );
    }

    const origin = normalizeRelayUrl(parsed.origin);
    await resolvePublicAddresses(origin.host);

    const normalized = new URL(origin.canonicalRelayUrl);
    normalized.pathname = parsed.pathname;
    relays.push(normalized.toString());
  }

  return [...new Set(relays)];
}
