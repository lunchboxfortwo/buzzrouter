import type { Event } from "nostr-tools/core";
import { npubEncode } from "nostr-tools/nip19";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import { ApiError } from "../http/api-error";

/**
 * Client for Block's hosted Buzz (Builderlab) identity + community API.
 *
 * The whole contract below was verified empirically against the real service
 * `app.builderlab.xyz` on 2026-07-31 (see the live-proof report). A
 * self-generated Nostr key was bound with NO desktop app, NO pre-registration,
 * and NO key-provenance check, then used to create a real hosted community.
 * Source references (Block's `github.com/block/buzz`) that fix the exact shapes:
 *   - kind-24243 event tags + order: `desktop/src-tauri/src/commands/identity.rs:373-405`
 *   - `signed_payload` is the raw event JSON string: `builderlab.rs:481-524` (esp. :520)
 *   - required headers + Origin check: `builderlab.rs:15-22,424-464`
 *   - login/exchange: `builderlab.rs:170-365`
 *   - community paths: `builderlab.rs:467-586`
 *   - community-name rule + 3-per-account limit: `hostedCommunityApi.ts:4-5,68-81`
 *
 * This module never persists or logs the caller's secret key; the secret only
 * enters `bindNostrIdentity` to sign, and never leaves in any request body (the
 * bind proof carries the pubkey + signature, not the secret).
 */

/** The kind of the identity-binding event. */
export const NOSTR_IDENTITY_BINDING_KIND = 24_243;

/** Community name rule (`hostedCommunityApi.ts:4-5`): lowercase, dash-joined. */
const COMMUNITY_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Real hosted service. Live calls are gated behind an env flag (see below). */
export const DEFAULT_BUILDERLAB_ORIGIN = "https://app.builderlab.xyz";
export const DEFAULT_BUILDERLAB_BASE_URL =
  "https://app.builderlab.xyz/api/goose";

export interface BuilderlabChallenge {
  action: string;
  audience: string;
  challenge_id: string;
  expires_at: string;
  kind: number;
  nonce: string;
  origin: string;
  protocol: string;
  verification_code: string;
  version: string;
}

export interface BuilderlabIdentity {
  npub: string;
  pubkey_hex: string;
}

export interface BuilderlabCommunity {
  id: string;
  normalized_host: string;
  owner_pubkey: string;
}

export interface BuilderlabSession {
  expiresAt: string;
  sessionCredential: string;
}

type FetchLike = typeof fetch;

export interface BuilderlabClientConfig {
  baseUrl: string;
  fetch: FetchLike;
  /** Injectable clock (ms). Kept injectable so tests are deterministic. */
  now: () => number;
  origin: string;
}

export interface BuilderlabClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
  origin?: string;
}

/**
 * Builds a client config for LIVE calls against the real hosted service. Live
 * egress is opt-in: it refuses unless `BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE=1`
 * is set, so tests and CI never reach the real Builderlab by default. Tests
 * construct `BuilderlabClient` with an explicit config + fake fetch instead.
 */
export function resolveLiveBuilderlabConfig(
  options: BuilderlabClientOptions = {},
): BuilderlabClientConfig {
  const baseUrl =
    options.baseUrl ??
    process.env.BUZZROUTER_BUILDERLAB_BASE_URL ??
    DEFAULT_BUILDERLAB_BASE_URL;
  assertLiveEgressAllowed(baseUrl, { requireRealHost: false });
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ApiError(
      "hosted_signup_fetch_unavailable",
      "No fetch implementation is available for hosted-signup calls.",
      500,
    );
  }
  return {
    baseUrl,
    fetch: fetchImpl,
    now: options.now ?? (() => Date.now()),
    origin:
      options.origin ??
      process.env.BUZZROUTER_BUILDERLAB_ORIGIN ??
      DEFAULT_BUILDERLAB_ORIGIN,
  };
}

export class BuilderlabClient {
  private readonly config: BuilderlabClientConfig;

  constructor(config: BuilderlabClientConfig) {
    // Defense-in-depth: the live-egress flag guards `resolveLiveBuilderlabConfig`,
    // but the class is directly constructable, so also enforce the flag here
    // when the base URL points at the real hosted service. Fake/test hosts are
    // unaffected.
    assertLiveEgressAllowed(config.baseUrl);
    this.config = config;
  }

  /**
   * Exchanges an OAuth `code` (from the one interactive Auth0 login) for a
   * session credential. Server-side and unauthenticated — no session header.
   * `builderlab.rs:170-365`.
   */
  async exchangeLoginCode(code: string): Promise<BuilderlabSession> {
    if (typeof code !== "string" || code.length === 0) {
      throw new ApiError("invalid_input", "Login code is required.");
    }
    const body = await this.post(
      "/v1/auth/login/exchange",
      { code },
      undefined,
    );
    const sessionCredential = asNonEmptyString(
      body.session_credential,
      "session_credential",
    );
    const expiresAt = asNonEmptyString(body.expires_at, "expires_at");
    return { expiresAt, sessionCredential };
  }

  /**
   * Requests a fresh binding challenge. `origin` in the body must be the
   * configured origin (`builderlab.rs:17-22` enforces it server-side).
   */
  async requestChallenge(
    sessionCredential: string,
  ): Promise<BuilderlabChallenge> {
    const body = await this.post(
      "/v1/buzz/nostr-identities/challenge",
      { origin: this.config.origin },
      sessionCredential,
    );
    const challenge: BuilderlabChallenge = {
      action: asNonEmptyString(body.action, "action"),
      audience: asNonEmptyString(body.audience, "audience"),
      challenge_id: asNonEmptyString(body.challenge_id, "challenge_id"),
      expires_at: asNonEmptyString(body.expires_at, "expires_at"),
      kind: asKind(body.kind),
      nonce: asNonEmptyString(body.nonce, "nonce"),
      origin: asNonEmptyString(body.origin, "origin"),
      protocol: asNonEmptyString(body.protocol, "protocol"),
      verification_code: asNonEmptyString(
        body.verification_code,
        "verification_code",
      ),
      version: asNonEmptyString(body.version, "version"),
    };
    return challenge;
  }

  /**
   * Signs the challenge with `secretKey` and posts the bind proof. The secret
   * key never leaves this method — only the signed event (pubkey + signature)
   * is sent. Throws `challenge_expired` (fail fast, before signing) if the
   * challenge's `expires_at` has already passed.
   */
  async bindNostrIdentity(
    sessionCredential: string,
    secretKey: Uint8Array,
    challenge: BuilderlabChallenge,
  ): Promise<BuilderlabIdentity> {
    assertChallengeFresh(challenge, this.config.now());
    const event = buildBindingEvent(
      secretKey,
      challenge,
      Math.floor(this.config.now() / 1_000),
    );
    // `signed_payload` is the raw event JSON as a STRING (builderlab.rs:520
    // `nostr::JsonUtil::as_json(&event)`), NOT `v1.`+base64url.
    const body = await this.post(
      "/v1/buzz/nostr-identities/verify",
      {
        challenge_id: challenge.challenge_id,
        nonce: challenge.nonce,
        signed_payload: JSON.stringify(event),
      },
      sessionCredential,
    );
    const identity = asObject(body.identity, "identity");
    return {
      npub: asNonEmptyString(identity.npub, "identity.npub"),
      pubkey_hex: asNonEmptyString(identity.pubkey_hex, "identity.pubkey_hex"),
    };
  }

  /**
   * Reads the identity currently bound to this session
   * (`/v1/buzz/nostr-identities/current`). Used ONLY on recovery: when a bind
   * returns `identity_already_bound`, this confirms whether it is OUR key
   * before we proceed. The `current` response shape isn't fully quoted in the
   * live-proof report, so parse leniently (nested `identity` or flat).
   */
  async getCurrentIdentity(
    sessionCredential: string,
  ): Promise<{ pubkey_hex: string }> {
    const body = await this.post(
      "/v1/buzz/nostr-identities/current",
      {},
      sessionCredential,
    );
    const source =
      typeof body.identity === "object" &&
      body.identity !== null &&
      !Array.isArray(body.identity)
        ? (body.identity as Record<string, unknown>)
        : body;
    return {
      pubkey_hex: asNonEmptyString(source.pubkey_hex, "pubkey_hex"),
    };
  }

  async checkCommunityAvailability(
    sessionCredential: string,
    name: string,
  ): Promise<{ available: boolean; normalized_host: string }> {
    assertCommunityName(name);
    const body = await this.post(
      "/v1/buzz/communities/availability",
      { name },
      sessionCredential,
    );
    return {
      available: asBoolean(body.available, "available"),
      normalized_host: asNonEmptyString(
        body.normalized_host,
        "normalized_host",
      ),
    };
  }

  async createCommunity(
    sessionCredential: string,
    name: string,
  ): Promise<BuilderlabCommunity> {
    assertCommunityName(name);
    const body = await this.post(
      "/v1/buzz/communities",
      { name },
      sessionCredential,
    );
    const community = asObject(body.community, "community");
    return {
      id: asNonEmptyString(community.id, "community.id"),
      normalized_host: asNonEmptyString(
        community.normalized_host,
        "community.normalized_host",
      ),
      owner_pubkey: asNonEmptyString(
        community.owner_pubkey,
        "community.owner_pubkey",
      ),
    };
  }

  private async post(
    path: string,
    payload: Record<string, unknown>,
    sessionCredential: string | undefined,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      origin: this.config.origin,
    };
    if (sessionCredential) {
      headers["x-bb-session-credential"] = sessionCredential;
    }
    let response: Response;
    try {
      response = await this.config.fetch(`${this.config.baseUrl}${path}`, {
        body: JSON.stringify(payload),
        headers,
        method: "POST",
      });
    } catch (error) {
      throw new ApiError(
        "builderlab_unreachable",
        "The hosted Buzz service could not be reached.",
        502,
        { cause: error },
      );
    }
    if (!response.ok) {
      // 429 gets a distinct code + Retry-After so a caller can back off. We
      // never auto-retry here: verify/create are not idempotent, and a blind
      // retry after a successful-but-slow bind is exactly the key-loss trap.
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw new ApiError(
          "builderlab_rate_limited",
          `The hosted Buzz service is rate-limiting ${path}` +
            (retryAfter ? ` (retry after ${retryAfter}).` : "."),
          429,
        );
      }
      // Surface a KNOWN upstream error code verbatim (e.g. identity_already_bound)
      // so the orchestrator can make recovery decisions; the body never carries
      // our secret, only the server's own error string.
      const upstream = await readUpstreamErrorCode(response);
      throw new ApiError(
        upstream && KNOWN_UPSTREAM_CODES.has(upstream)
          ? upstream
          : "builderlab_rejected",
        `The hosted Buzz service rejected ${path} (status ${response.status}).`,
        502,
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new ApiError(
        "builderlab_invalid_response",
        `The hosted Buzz service returned an unreadable ${path} response.`,
        502,
        { cause: error },
      );
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new ApiError(
        "builderlab_invalid_response",
        `The hosted Buzz service returned an unexpected ${path} response.`,
        502,
      );
    }
    return json as Record<string, unknown>;
  }
}

/**
 * Builds the kind-24243 identity-binding event. THIS IS THE ONE PLACE the event
 * shape lives. Tag content and ORDER match Block's
 * `build_nostr_identity_binding_event` (`identity.rs:373-405`) exactly — the
 * server recomputes the event id over this serialization, so the order is
 * load-bearing.
 */
export function buildBindingEvent(
  secretKey: Uint8Array,
  challenge: BuilderlabChallenge,
  createdAt: number,
): Event {
  return finalizeEvent(
    {
      content: "",
      created_at: createdAt,
      kind: NOSTR_IDENTITY_BINDING_KIND,
      tags: [
        ["challenge_id", challenge.challenge_id],
        ["nonce", challenge.nonce],
        ["verification_code", challenge.verification_code],
        ["audience", challenge.audience],
        ["action", challenge.action],
        ["protocol", challenge.protocol],
        ["version", challenge.version],
        ["origin", challenge.origin],
        ["expires_at", challenge.expires_at],
      ],
    },
    secretKey,
  );
}

export function assertChallengeFresh(
  challenge: BuilderlabChallenge,
  nowMs: number,
): void {
  const expiresMs = Date.parse(challenge.expires_at);
  if (Number.isNaN(expiresMs)) {
    throw new ApiError(
      "challenge_invalid",
      "The binding challenge has an invalid expiry.",
      502,
    );
  }
  if (expiresMs <= nowMs) {
    throw new ApiError(
      "challenge_expired",
      "The binding challenge has expired; request a new one.",
      409,
    );
  }
}

export function assertCommunityName(name: string): void {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 63 ||
    !COMMUNITY_NAME_RE.test(name)
  ) {
    throw new ApiError(
      "invalid_community_name",
      "Community name must be lowercase letters, digits, and single dashes.",
    );
  }
}

/** Convenience for callers/tests holding a hex pubkey. */
export function npubFor(pubkeyHex: string): string {
  return npubEncode(pubkeyHex);
}

/** Exposed for the orchestrator: derive the bind pubkey without signing. */
export function pubkeyForSecret(secretKey: Uint8Array): string {
  return getPublicKey(secretKey);
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(
      "builderlab_invalid_response",
      `The hosted Buzz service response is missing "${field}".`,
      502,
    );
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ApiError(
      "builderlab_invalid_response",
      `The hosted Buzz service response has a non-boolean "${field}".`,
      502,
    );
  }
  return value;
}

function asKind(value: unknown): number {
  if (value !== NOSTR_IDENTITY_BINDING_KIND) {
    throw new ApiError(
      "builderlab_invalid_response",
      `The binding challenge kind must be ${NOSTR_IDENTITY_BINDING_KIND}.`,
      502,
    );
  }
  return value;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(
      "builderlab_invalid_response",
      `The hosted Buzz service response is missing "${field}".`,
      502,
    );
  }
  return value as Record<string, unknown>;
}

/** Upstream error strings the orchestrator branches on for recovery. */
const KNOWN_UPSTREAM_CODES = new Set([
  "identity_already_bound",
  "community_name_taken",
]);

async function readUpstreamErrorCode(
  response: Response,
): Promise<string | null> {
  try {
    const body = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      typeof (body as Record<string, unknown>).error === "string"
    ) {
      const error = (body as Record<string, string>).error;
      return error.length > 0 ? error : null;
    }
  } catch {
    // Non-JSON error body — nothing to extract.
  }
  return null;
}

function pointsAtRealHost(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return false;
  }
  return (
    host === new URL(DEFAULT_BUILDERLAB_BASE_URL).host ||
    host === new URL(DEFAULT_BUILDERLAB_ORIGIN).host
  );
}

/**
 * Enforces the `BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE` opt-in. With
 * `requireRealHost: false` the flag is required unconditionally (the caller is
 * explicitly asking for a live config). With `requireRealHost: true` (the
 * constructor's default) the flag is required only when `baseUrl` points at the
 * real hosted service, so fake/test hosts construct freely.
 */
function assertLiveEgressAllowed(
  baseUrl: string,
  opts: { requireRealHost: boolean } = { requireRealHost: true },
): void {
  if (process.env.BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE === "1") return;
  if (opts.requireRealHost && !pointsAtRealHost(baseUrl)) return;
  throw new ApiError(
    "hosted_signup_live_disabled",
    "Live hosted-signup calls are disabled. Set " +
      "BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE=1 to enable them.",
    503,
  );
}
