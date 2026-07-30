import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

import { DiscoveryError, toDiscoveryError } from "./errors";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.aws.internal",
]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".onion",
  ".example",
  ".invalid",
  ".test",
];

export interface PublicAddress {
  address: string;
  family: 4 | 6;
}

export type AddressResolver = (host: string) => Promise<PublicAddress[]>;
export type DnsLookup = (
  host: string,
) => Promise<Array<{ address: string; family: number }>>;

export async function resolvePublicAddresses(
  host: string,
  lookupHost: DnsLookup = (hostname) =>
    dnsLookup(hostname, { all: true, verbatim: true }),
): Promise<PublicAddress[]> {
  assertPublicHostname(host);

  const literalFamily = isIP(host);
  if (literalFamily !== 0) {
    assertPublicIp(host);
    return [{ address: host, family: literalFamily as 4 | 6 }];
  }

  let answers: Awaited<ReturnType<DnsLookup>>;
  try {
    answers = await lookupHost(host);
  } catch (error) {
    throw toDiscoveryError(error, "dns_failed", "Candidate DNS lookup failed.");
  }

  if (answers.length === 0) {
    throw new DiscoveryError(
      "dns_no_answers",
      "Candidate DNS lookup returned no addresses.",
    );
  }

  const deduplicated = new Map<string, PublicAddress>();
  for (const answer of answers) {
    if (answer.family !== 4 && answer.family !== 6) {
      throw new DiscoveryError(
        "blocked_address",
        "Candidate address family is invalid.",
      );
    }

    assertPublicIp(answer.address);
    deduplicated.set(answer.address, {
      address: answer.address,
      family: answer.family,
    });
  }

  return [...deduplicated.values()];
}

export function assertPublicHostname(host: string): void {
  const normalized = host.toLowerCase().replace(/\.$/, "");

  if (
    BLOCKED_HOSTS.has(normalized) ||
    BLOCKED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    throw new DiscoveryError(
      "blocked_host",
      "Candidate host is not publicly routable.",
    );
  }
}

export function assertPublicIp(address: string): void {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;

  try {
    parsed = ipaddr.parse(address);
  } catch {
    throw new DiscoveryError(
      "blocked_address",
      "Candidate address is invalid.",
    );
  }

  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address();
  }

  if (parsed.range() !== "unicast") {
    throw new DiscoveryError(
      "blocked_address",
      "Candidate address is not publicly routable.",
    );
  }
}
