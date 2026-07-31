import { buildNip98Header, claimEndpoint } from "./claim";
import {
  acceptJoinPolicy,
  getJoinPolicy,
  isJoinPolicyRequired,
} from "./policy";

/**
 * Non-consuming freshness probe for a Buzz invite. The BuzzRouter Agent is
 * already a member of the communities whose directory invites it maintains, so
 * claiming one of those invites is a safe read: the relay answers 200
 * `already_member` (or `joined`) WITHOUT consuming a use or firing any join
 * side effects, and answers 403 with a specific `error` code when the invite is
 * no longer usable. This module reads that body `error` field directly — unlike
 * `claimInvite`, which collapses every 403 to a generic `forbidden` — so the
 * freshness job can tell a live invite from an expired or invalid one.
 *
 *   - HTTP 200/201                          → "live"
 *   - HTTP 403 { error: "invite_expired" }  → "expired"
 *   - HTTP 403 { error: "invite_invalid" }  → "invalid"
 *   - HTTP 403 { error: "join_policy_required" } → accept the policy and retry
 *   - transport failure / anything else     → "error" (never throws)
 */

export type InviteHealth = "live" | "expired" | "invalid" | "error";

export interface ProbeInviteOptions {
  host: string;
  code: string;
  privateKey: Uint8Array;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Override the signed timestamp (seconds); defaults to now. */
  now?: number;
}

interface ClaimAttempt {
  status: number;
  body: unknown;
}

/**
 * Probes a single invite and classifies its health. Reuses the join-policy
 * handshake for policy-gated communities and classifies purely by HTTP status
 * plus the response body `error`/`status` field. Any transport failure or
 * unexpected response is reported as `"error"` rather than thrown, so a batch
 * caller can classify a whole invite set uniformly.
 */
export async function probeInvite(
  options: ProbeInviteOptions,
): Promise<InviteHealth> {
  const { code, host, now, privateKey } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  let first: ClaimAttempt;
  try {
    first = await claimOnce({ code, fetchImpl, host, now, privateKey });
  } catch {
    return "error";
  }

  if (!(first.status === 403 && isJoinPolicyRequired(first.body))) {
    return classifyProbe(first.status, first.body);
  }

  // A join policy is configured: accept it, then retry the claim with the
  // receipt. `ageConfirmed` is the authorized/counsel-approved attestation used
  // everywhere the agent transacts with Buzz.
  let policyVersion: string;
  try {
    policyVersion = (await getJoinPolicy(host, fetchImpl)).version;
  } catch {
    return "error";
  }
  const accepted = await acceptJoinPolicy({
    ageConfirmed: true,
    code,
    fetchImpl,
    host,
    now,
    policyVersion,
    privateKey,
  });
  if (!accepted.ok) return "error";

  let retry: ClaimAttempt;
  try {
    retry = await claimOnce({
      code,
      fetchImpl,
      host,
      now,
      policyReceipt: accepted.receipt,
      privateKey,
    });
  } catch {
    return "error";
  }
  return classifyProbe(retry.status, retry.body);
}

/** Maps an invite-claim status + body to a health classification. */
function classifyProbe(status: number, body: unknown): InviteHealth {
  if (status === 200 || status === 201) return "live";
  if (status === 403) {
    const error = errorCode(body);
    if (error === "invite_expired") return "expired";
    if (error === "invite_invalid") return "invalid";
  }
  return "error";
}

interface ClaimOnceOptions {
  host: string;
  code: string;
  privateKey: Uint8Array;
  fetchImpl: typeof fetch;
  policyReceipt?: string;
  now?: number;
}

/**
 * Signs and POSTs one invite claim, returning the raw status + parsed body.
 * Throws on transport failure so the caller can classify it as `"error"`.
 */
async function claimOnce(options: ClaimOnceOptions): Promise<ClaimAttempt> {
  const url = claimEndpoint(options.host);
  const body = JSON.stringify(
    options.policyReceipt
      ? { code: options.code, policy_receipt: options.policyReceipt }
      : { code: options.code },
  );
  const authorization = buildNip98Header({
    body,
    method: "POST",
    now: options.now,
    privateKey: options.privateKey,
    url,
  });

  const response = await options.fetchImpl(url, {
    body,
    headers: {
      authorization,
      "content-type": "application/json",
    },
    method: "POST",
  });

  return { body: await readResponseBody(response), status: response.status };
}

async function readResponseBody(response: Response): Promise<unknown> {
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

/** Reads the body `error` field (used to distinguish 403 outcomes). */
function errorCode(body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const value = (body as Record<string, unknown>).error;
    if (typeof value === "string") return value;
  }
  return "";
}
