import { createHash, randomUUID } from "node:crypto";

import { finalizeEvent } from "nostr-tools/pure";

/**
 * Claims a Buzz invite over HTTP. The joining agent authorizes the request with
 * a NIP-98 (kind:27235) signature; the `/api/invites/claim` endpoint is exempt
 * from the relay membership gate, so a valid claim is how the agent gets a
 * foothold in a community. Responses are classified so the caller can reason
 * about invite health (expired vs invalid vs unauthorized, etc.).
 */

const NIP98_KIND = 27_235;

export type ClaimFailureReason =
  | "unauthorized" // 401 — NIP-98 signature rejected
  | "forbidden" // 403 — signer not allowed to claim
  | "not_found" // 404 — no such invite/host
  | "expired" // 410 (or body says expired) — invite no longer valid
  | "invalid" // 400/409/422 — malformed or already-used invite
  | "rate_limited" // 429
  | "server_error" // 5xx
  | "network_error"; // request never completed

export type ClaimResult =
  | { ok: true; status: number; body: unknown }
  | {
      ok: false;
      status: number;
      reason: ClaimFailureReason;
      body?: unknown;
    };

export interface ClaimInviteOptions {
  host: string;
  code: string;
  privateKey: Uint8Array;
  /**
   * Optional join-policy receipt (from `acceptJoinPolicy`). When a community
   * configures a join policy, a claim without a receipt is rejected with
   * `403 join_policy_required`; supplying the receipt satisfies the gate.
   */
  policyReceipt?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Override the signed timestamp (seconds); defaults to now. */
  now?: number;
}

export interface Nip98HeaderOptions {
  url: string;
  method: string;
  privateKey: Uint8Array;
  body?: string;
  now?: number;
  nonce?: string;
}

/**
 * Normalizes a relay host to its bare `host[:port]` form, stripping any
 * `wss://`/`https://` scheme and trailing slashes. Shared by every Buzz HTTP
 * API endpoint builder so they agree on what "host" means.
 */
export function normalizeHost(host: string): string {
  const bare = host
    .trim()
    .replace(/^wss?:\/\//i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (bare.length === 0) {
    throw new Error("A relay host is required to reach the Buzz API.");
  }
  return bare;
}

/** Builds the `https://{host}/api/invites/claim` endpoint URL from a host. */
export function claimEndpoint(host: string): string {
  return `https://${normalizeHost(host)}/api/invites/claim`;
}

/**
 * Constructs a `Nostr <base64>` Authorization header per NIP-98: a signed
 * kind:27235 event carrying the request URL, method, a unique nonce, and (when
 * a body is present) the sha256 payload hash.
 */
export function buildNip98Header(options: Nip98HeaderOptions): string {
  const method = options.method.toUpperCase();
  const tags: string[][] = [
    ["u", options.url],
    ["method", method],
    ["nonce", options.nonce ?? randomUUID()],
  ];
  if (options.body !== undefined && options.body.length > 0) {
    tags.push([
      "payload",
      createHash("sha256").update(options.body).digest("hex"),
    ]);
  }

  const event = finalizeEvent(
    {
      content: "",
      created_at: options.now ?? Math.floor(Date.now() / 1_000),
      kind: NIP98_KIND,
      tags,
    },
    options.privateKey,
  );
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

/** Maps an HTTP status + response body to a typed claim result. */
export function classifyClaimResponse(
  status: number,
  body: unknown,
): ClaimResult {
  if (status === 200 || status === 201) {
    return { body, ok: true, status };
  }

  const message = reasonText(body).toLowerCase();
  const looksExpired = /expir|no longer/.test(message);

  switch (status) {
    case 401:
      return { body, ok: false, reason: "unauthorized", status };
    case 403:
      return { body, ok: false, reason: "forbidden", status };
    case 404:
      return { body, ok: false, reason: "not_found", status };
    case 410:
      return { body, ok: false, reason: "expired", status };
    case 429:
      return { body, ok: false, reason: "rate_limited", status };
    case 400:
    case 409:
    case 422:
      return {
        body,
        ok: false,
        reason: looksExpired ? "expired" : "invalid",
        status,
      };
    default:
      if (status >= 500) {
        return { body, ok: false, reason: "server_error", status };
      }
      return {
        body,
        ok: false,
        reason: looksExpired ? "expired" : "invalid",
        status,
      };
  }
}

/**
 * Signs and POSTs an invite claim. Network-level failures are surfaced as a
 * `network_error` result rather than thrown, so batch callers can classify a
 * whole invite list uniformly.
 */
export async function claimInvite(
  options: ClaimInviteOptions,
): Promise<ClaimResult> {
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
      body: error instanceof Error ? error.message : String(error),
      ok: false,
      reason: "network_error",
      status: 0,
    };
  }

  const parsed = await readResponseBody(response);
  return classifyClaimResponse(response.status, parsed);
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

function reasonText(body: unknown): string {
  if (typeof body === "string") return body;
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    for (const key of ["reason", "error", "message", "detail"]) {
      const value = record[key];
      if (typeof value === "string") return value;
    }
  }
  return "";
}
