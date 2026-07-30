import { domainToASCII } from "node:url";
import { isIP } from "node:net";

import { DiscoveryError } from "./errors";

const ACCEPTED_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
const MAX_HOST_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

export interface NormalizedRelay {
  canonicalRelayUrl: string;
  host: string;
  port: number | null;
}

export function normalizeRelayUrl(input: string): NormalizedRelay {
  let parsed: URL;

  try {
    parsed = new URL(input);
  } catch {
    throw new DiscoveryError("invalid_url", "Candidate is not a valid URL.");
  }

  if (!ACCEPTED_PROTOCOLS.has(parsed.protocol)) {
    throw new DiscoveryError(
      "unsupported_scheme",
      "Candidate must use HTTP or WebSocket transport.",
    );
  }

  if (parsed.username || parsed.password) {
    throw new DiscoveryError(
      "embedded_credentials",
      "Candidate URLs cannot contain credentials.",
    );
  }

  const host = normalizeHost(parsed.hostname);
  const port = normalizePort(parsed);
  const authorityHost = isIP(host) === 6 ? `[${host}]` : host;
  const authority = port === null ? authorityHost : `${authorityHost}:${port}`;

  return {
    canonicalRelayUrl: `wss://${authority}`,
    host,
    port,
  };
}

function normalizeHost(urlHostname: string): string {
  const unwrapped = unwrapIpv6(urlHostname).toLowerCase().replace(/\.$/, "");

  if (!unwrapped) {
    throw new DiscoveryError("invalid_host", "Candidate host is empty.");
  }

  if (isIP(unwrapped) !== 0) {
    return unwrapped;
  }

  const ascii = domainToASCII(unwrapped);
  if (!ascii || ascii.length > MAX_HOST_LENGTH) {
    throw new DiscoveryError("invalid_host", "Candidate host is invalid.");
  }

  const labels = ascii.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > MAX_LABEL_LENGTH ||
        !/^[a-z0-9-]+$/.test(label) ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    throw new DiscoveryError("invalid_host", "Candidate host is invalid.");
  }

  return ascii;
}

function normalizePort(parsed: URL): number | null {
  if (!parsed.port) {
    return null;
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new DiscoveryError("invalid_url", "Candidate port is invalid.");
  }

  const inputDefaultPort =
    parsed.protocol === "http:" || parsed.protocol === "ws:" ? 80 : 443;

  return port === inputDefaultPort ? null : port;
}

function unwrapIpv6(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}
