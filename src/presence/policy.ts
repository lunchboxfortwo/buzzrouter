import {
  buildNip98Header,
  claimInvite,
  normalizeHost,
  type ClaimFailureReason,
} from "./claim";

/**
 * Buzz join-policy handshake. Before an agent may claim an invite into a
 * community that has configured a join policy, the joining key must accept the
 * policy — Block's Terms of Service plus an 18+ age attestation — and present
 * the resulting receipt with its claim. A claim without a receipt when a policy
 * is configured is rejected with `403 { error: "join_policy_required" }`.
 *
 * The handshake is:
 *   1. GET  /api/join-policy            (public)             → current policy
 *   2. POST /api/invites/accept-policy  (NIP-98 authorized)  → { receipt }
 *   3. POST /api/invites/claim          (NIP-98 authorized)  → joined body
 *
 * `acceptTerms` is the single, explicit, caller-supplied gate over BOTH
 * accepting the ToS AND the 18+ age attestation. It is never inferred and never
 * defaulted to true.
 */

export interface JoinPolicy {
  version: string;
  ageAttestationRequired: boolean;
  termsMarkdown?: string;
  privacyMarkdown?: string;
}

export interface AcceptJoinPolicyOptions {
  host: string;
  code: string;
  policyVersion: string;
  ageConfirmed: boolean;
  privateKey: Uint8Array;
  fetchImpl?: typeof fetch;
  now?: number;
}

export type AcceptJoinPolicyResult =
  | { ok: true; receipt: string }
  | { ok: false; status: number; reason: string };

export interface JoinedCommunityInfo {
  /** Bare relay host of the community that was just joined. */
  host: string;
  /** Community id from the joined response body, when present. */
  communityId?: string;
}

export interface JoinCommunityOptions {
  host: string;
  code: string;
  privateKey: Uint8Array;
  /**
   * Explicit acceptance of Block's Terms of Service AND the 18+ age
   * attestation. Never inferred; the caller must pass `true` to join a
   * policy-gated community.
   */
  acceptTerms: boolean;
  /**
   * Invoked once after a successful join with the community identifiers, so a
   * caller can record membership (e.g. upsert into `presence_communities`)
   * without this module taking a database dependency. Errors thrown here are
   * swallowed — bookkeeping never fails an otherwise-successful join.
   */
  onJoined?: (info: JoinedCommunityInfo) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  now?: number;
}

export type JoinCommunityResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; reason: "terms_required" }
  | {
      ok: false;
      status: number;
      reason: ClaimFailureReason | "policy_accept_failed";
      body?: unknown;
    };

/** Builds the public `https://{host}/api/join-policy` endpoint URL. */
export function joinPolicyEndpoint(host: string): string {
  return `https://${normalizeHost(host)}/api/join-policy`;
}

/** Builds the `https://{host}/api/invites/accept-policy` endpoint URL. */
export function acceptPolicyEndpoint(host: string): string {
  return `https://${normalizeHost(host)}/api/invites/accept-policy`;
}

/**
 * Fetches the community's current join policy. Public — no NIP-98 auth. Throws
 * on transport failure or an unexpected response shape so the caller does not
 * silently proceed as if there were no policy.
 */
export async function getJoinPolicy(
  host: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JoinPolicy | null> {
  const url = joinPolicyEndpoint(host);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch join policy from ${url}: HTTP ${response.status}.`,
    );
  }
  const parsed = (await response.json()) as {
    policy?: {
      version?: unknown;
      age_attestation_required?: unknown;
      terms_markdown?: unknown;
      privacy_markdown?: unknown;
    };
  };
  const policy = parsed.policy;
  // A 200 with no `policy` means the community has NO join policy configured —
  // the EASIEST case, not a failure. A bare claim admits you and no receipt is
  // needed. Conflating this with "the relay is unreachable" told visitors to
  // BuzzRouter's own community "we couldn't reach it" and offered a pointless
  // detour to Buzz. Callers get null and must treat it as "nothing to accept";
  // a genuine transport/HTTP failure still throws.
  if (!policy) return null;
  if (typeof policy.version !== "string") {
    throw new Error(`Malformed join policy response from ${url}.`);
  }
  const result: JoinPolicy = {
    ageAttestationRequired: policy.age_attestation_required === true,
    version: policy.version,
  };
  if (typeof policy.terms_markdown === "string") {
    result.termsMarkdown = policy.terms_markdown;
  }
  if (typeof policy.privacy_markdown === "string") {
    result.privacyMarkdown = policy.privacy_markdown;
  }
  return result;
}

/**
 * Accepts the join policy on behalf of the agent, returning the receipt the
 * subsequent claim must present. `ageConfirmed` is sent verbatim as
 * `age_confirmed`; the orchestrator sources it from the explicit `acceptTerms`
 * gate.
 */
export async function acceptJoinPolicy(
  options: AcceptJoinPolicyOptions,
): Promise<AcceptJoinPolicyResult> {
  const url = acceptPolicyEndpoint(options.host);
  const body = JSON.stringify({
    age_confirmed: options.ageConfirmed,
    code: options.code,
    policy_version: options.policyVersion,
  });
  const authorization = buildNip98Header({
    body,
    method: "POST",
    now: options.now,
    privateKey: options.privateKey,
    url,
  });
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      body,
      headers: {
        authorization,
        "content-type": "application/json",
      },
      method: "POST",
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      status: 0,
    };
  }

  const parsed = await readJson(response);
  if (response.ok) {
    const receipt =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).receipt
        : undefined;
    if (typeof receipt === "string" && receipt.length > 0) {
      return { ok: true, receipt };
    }
    return {
      ok: false,
      reason: "accept-policy succeeded but returned no receipt",
      status: response.status,
    };
  }
  return {
    ok: false,
    reason: errorText(parsed) || `HTTP ${response.status}`,
    status: response.status,
  };
}

/**
 * Orchestrates the full join: attempt a bare claim first, and only run the
 * policy handshake when the relay demands it (`403 join_policy_required`). If a
 * policy is required but `acceptTerms` is not explicitly `true`, returns
 * `{ ok: false, reason: "terms_required" }` WITHOUT accepting anything.
 */
export async function joinCommunity(
  options: JoinCommunityOptions,
): Promise<JoinCommunityResult> {
  const { acceptTerms, code, fetchImpl, host, now, privateKey } = options;

  const first = await claimInvite({ code, fetchImpl, host, now, privateKey });
  if (first.ok) {
    await notifyJoined(options.onJoined, host, first.body);
    return { body: first.body, ok: true, status: first.status };
  }
  if (!(first.status === 403 && isJoinPolicyRequired(first.body))) {
    return {
      body: first.body,
      ok: false,
      reason: first.reason,
      status: first.status,
    };
  }

  // A join policy is configured. Refuse to accept terms unless told to.
  if (acceptTerms !== true) {
    return { ok: false, reason: "terms_required" };
  }

  const policy = await getJoinPolicy(host, fetchImpl ?? fetch);
  // The relay refused for policy reasons but advertises no policy. Report the
  // contradiction rather than fabricating an acceptance.
  if (!policy) {
    return {
      ok: false as const,
      reason: "policy_accept_failed" as const,
      status: 0,
    };
  }
  const accepted = await acceptJoinPolicy({
    ageConfirmed: acceptTerms,
    code,
    fetchImpl,
    host,
    now,
    policyVersion: policy.version,
    privateKey,
  });
  if (!accepted.ok) {
    return {
      ok: false,
      reason: "policy_accept_failed",
      status: accepted.status,
    };
  }

  const claimed = await claimInvite({
    code,
    fetchImpl,
    host,
    now,
    policyReceipt: accepted.receipt,
    privateKey,
  });
  if (claimed.ok) {
    await notifyJoined(options.onJoined, host, claimed.body);
    return { body: claimed.body, ok: true, status: claimed.status };
  }
  return {
    body: claimed.body,
    ok: false,
    reason: claimed.reason,
    status: claimed.status,
  };
}

/**
 * Best-effort membership notification. Extracts `community_id` from the joined
 * body when present and swallows any error from the callback so a bookkeeping
 * failure never turns a successful join into a failed one.
 */
async function notifyJoined(
  onJoined: JoinCommunityOptions["onJoined"],
  host: string,
  body: unknown,
): Promise<void> {
  if (!onJoined) return;
  const communityId = communityIdFromBody(body);
  try {
    await onJoined(communityId ? { communityId, host } : { host });
  } catch {
    // Intentionally ignored — see the onJoined doc comment.
  }
}

function communityIdFromBody(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null) {
    const value = (body as Record<string, unknown>).community_id;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** True when a claim failure body is the `join_policy_required` signal. */
export function isJoinPolicyRequired(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  return (body as Record<string, unknown>).error === "join_policy_required";
}

async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(body: unknown): string {
  if (typeof body === "string") return body;
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    for (const key of ["error", "reason", "message", "detail"]) {
      const value = record[key];
      if (typeof value === "string") return value;
    }
  }
  return "";
}
