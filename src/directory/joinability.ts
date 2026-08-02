import { generateSecretKey } from "nostr-tools/pure";

import { claimInvite } from "../presence/claim";
import { getJoinPolicy } from "../presence/policy";

/**
 * Decides whether a community will ACTUALLY accept a join with the invite code
 * we advertise, rather than assuming a code means "joinable".
 *
 * The directory used to treat any harvested invite code as a join button. Buzz
 * communities gate joins two ways: an age/ToS handshake (a bare claim without a
 * receipt is refused with `403 join_policy_required`), and per-community
 * admission (owner-only / allowlist / anyone). So a code is not proof a claim
 * lands — which is exactly the dead-end a user hit: the deep link's bare claim
 * was refused and the client spun forever.
 *
 * The cheapest correct signal, in priority order:
 *
 *   1. Read the PUBLIC join policy (`GET /api/join-policy`). When it requires an
 *      age attestation, a bare claim is GUARANTEED to fail `join_policy_required`
 *      — so we classify `policy_gated` WITHOUT a claim, burning no invite use.
 *      (Verified live: every age-gated community refuses a bare claim, and the
 *      claim only lands after the accept-policy handshake.)
 *   2. Only when there is no age gate do we spend a SINGLE bare claim to learn
 *      whether admission is open. We use a throwaway key — this models a brand
 *      new user, and never lets an agent's existing membership read as "open".
 *      A bare claim consumes an invite use ONLY when it succeeds (a genuinely
 *      open community), which is the one case a join was going to happen anyway;
 *      every refusal (gated / restricted / stale) consumes nothing.
 *
 * The host flows straight into `getJoinPolicy`/`claimInvite`, which normalize it
 * through the shared `normalizeHost` and pin the request to `https://<host>` —
 * the same SSRF-safe path every other Buzz API call uses. Do not build URLs here.
 */

export type JoinStatus =
  | "open"
  | "policy_gated"
  | "restricted"
  | "stale"
  | "unknown";

export interface JoinabilityVerdict {
  status: JoinStatus;
  /** Short machine reason (the relay's error code, or the transport failure). */
  detail?: string;
}

export interface ProbeJoinabilityOptions {
  host: string;
  code: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Override the signed timestamp (seconds); defaults to now. */
  now?: number;
  /**
   * Injectable throwaway key (tests). Defaults to a fresh random key per call so
   * the probe faithfully models a brand-new user rather than the agent.
   */
  ephemeralKey?: Uint8Array;
}

/**
 * Probes one community's claimability and classifies it. Never throws: a policy
 * read that fails falls back to the bare claim, and any transport failure is
 * reported as `unknown` so a batch caller can classify a whole set uniformly.
 */
export async function probeJoinability(
  options: ProbeJoinabilityOptions,
): Promise<JoinabilityVerdict> {
  const { code, host, now } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  // 1. Cheap public policy read. An age attestation means a bare claim can never
  //    land, so we can classify without spending a claim at all.
  try {
    const policy = await getJoinPolicy(host, fetchImpl);
    // null = no policy configured, so nothing gates a bare claim. Fall through
    // to the claim, which settles it authoritatively.
    if (policy?.ageAttestationRequired) {
      return { detail: "join_policy_required", status: "policy_gated" };
    }
  } catch {
    // No policy endpoint / transport hiccup — fall through to the bare claim,
    // which is the authoritative signal anyway.
  }

  // 2. No age gate: a single bare claim reveals whether admission is open. Fresh
  //    throwaway key so this reads as a new user and only "consumes" on success.
  const privateKey = options.ephemeralKey ?? generateSecretKey();
  const claim = await claimInvite({ code, fetchImpl, host, now, privateKey });
  if (claim.ok) {
    return { status: "open" };
  }

  const error = errorCode(claim.body);
  if (error === "join_policy_required") {
    return { detail: error, status: "policy_gated" };
  }
  if (claim.reason === "expired" || error === "invite_expired") {
    return { detail: error || claim.reason, status: "stale" };
  }
  if (
    claim.reason === "invalid" ||
    claim.reason === "not_found" ||
    error === "invite_invalid"
  ) {
    return { detail: error || claim.reason, status: "stale" };
  }
  if (
    claim.reason === "network_error" ||
    claim.reason === "server_error" ||
    claim.reason === "rate_limited" ||
    // A 401 means the relay rejected OUR NIP-98 signature — an our-side/transport
    // fault, not the community being closed. Withhold rather than brand it.
    claim.reason === "unauthorized"
  ) {
    return { detail: claim.reason, status: "unknown" };
  }
  // A 403 that is not the ToS gate, or any other non-transport refusal, is a real
  // admission barrier: owner-only / allowlist.
  return { detail: error || claim.reason, status: "restricted" };
}

/** Reads the body `error` field the relay returns to distinguish refusals. */
function errorCode(body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const value = (body as Record<string, unknown>).error;
    if (typeof value === "string") return value;
  }
  return "";
}
