import { createHash } from "node:crypto";

import type { Event } from "nostr-tools/core";
import { verifyEvent } from "nostr-tools/pure";
import type { Pool } from "pg";

import { ApiError } from "./api-error";

const NIP98_KIND = 27_235;
const AUTH_WINDOW_SECONDS = 60;
const MAX_AUTH_EVENT_BYTES = 16 * 1_024;
const MAX_BODY_BYTES = 16 * 1_024;

export interface AuthenticatedRequestBody {
  pubkey: string;
  rawBody: string;
  value: unknown;
}

export interface NostrIdentity {
  createdAt: number;
  eventId: string;
  pubkey: string;
}

export async function authenticateRequest(
  request: Request,
  pool: Pool,
): Promise<NostrIdentity> {
  const requestUrl = new URL(request.url);
  const canonicalUrl = canonicalRequestUrl(
    `${requestUrl.pathname}${requestUrl.search}`,
  );
  const identity = verifyNip98Authorization(
    request.headers.get("authorization"),
    canonicalUrl,
    request.method,
    "",
  );
  await consumeNip98Event(
    pool,
    identity,
    canonicalUrl,
    request.method,
  );
  return identity;
}

export async function authenticateJsonRequest(
  request: Request,
  pool: Pool,
): Promise<AuthenticatedRequestBody> {
  const rawBody = await readBoundedBody(request);
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new ApiError("invalid_input", "Request body is invalid.");
  }

  const requestUrl = new URL(request.url);
  const canonicalUrl = canonicalRequestUrl(
    `${requestUrl.pathname}${requestUrl.search}`,
  );
  const identity = verifyNip98Authorization(
    request.headers.get("authorization"),
    canonicalUrl,
    request.method,
    rawBody,
  );
  await consumeNip98Event(
    pool,
    identity,
    canonicalUrl,
    request.method,
  );

  return {
    pubkey: identity.pubkey,
    rawBody,
    value,
  };
}

export function verifyNip98Authorization(
  authorization: string | null,
  expectedUrl: string,
  method: string,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): NostrIdentity {
  const event = parseAuthorizationEvent(authorization);
  const normalizedMethod = method.toUpperCase();

  if (
    event.kind !== NIP98_KIND ||
    event.content !== "" ||
    Math.abs(nowSeconds - event.created_at) > AUTH_WINDOW_SECONDS ||
    !verifySafely(event)
  ) {
    throw invalidAuthentication();
  }

  const url = singleTag(event, "u");
  const signedMethod = singleTag(event, "method");
  if (url !== expectedUrl || signedMethod !== normalizedMethod) {
    throw invalidAuthentication();
  }

  if (rawBody.length > 0) {
    const payload = singleTag(event, "payload");
    const expectedPayload = createHash("sha256")
      .update(rawBody)
      .digest("hex");
    if (payload !== expectedPayload) {
      throw invalidAuthentication();
    }
  }

  return {
    createdAt: event.created_at,
    eventId: event.id,
    pubkey: event.pubkey,
  };
}

export async function consumeNip98Event(
  pool: Pool,
  identity: NostrIdentity,
  requestUrl: string,
  requestMethod: string,
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `
      WITH cleanup AS (
        DELETE FROM nostr_auth_events
        WHERE used_at < now() - interval '15 minutes'
      )
      INSERT INTO nostr_auth_events (
        id,
        pubkey,
        request_url,
        request_method,
        event_created_at
      )
      VALUES ($1, $2, $3, $4, to_timestamp($5))
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `,
    [
      identity.eventId,
      identity.pubkey,
      requestUrl,
      requestMethod.toUpperCase(),
      identity.createdAt,
    ],
  );

  if (!result.rows[0]) {
    throw new ApiError(
      "authentication_replayed",
      "Authentication event was already used.",
      401,
    );
  }
}

export function canonicalRequestUrl(pathAndSearch: string): string {
  const configuredOrigin = process.env.PUBLIC_APP_ORIGIN;
  if (!configuredOrigin) {
    throw new Error("PUBLIC_APP_ORIGIN is required.");
  }

  const origin = new URL(configuredOrigin);
  const loopbackHttp =
    origin.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !loopbackHttp)
  ) {
    throw new Error("PUBLIC_APP_ORIGIN must be an HTTPS origin.");
  }

  return new URL(pathAndSearch, origin).toString();
}

function parseAuthorizationEvent(authorization: string | null): Event {
  if (!authorization?.startsWith("Nostr ")) {
    throw new ApiError(
      "authentication_required",
      "Nostr authentication is required.",
      401,
    );
  }

  const encoded = authorization.slice(6);
  if (
    encoded.length === 0 ||
    encoded.length > MAX_AUTH_EVENT_BYTES * 2 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw invalidAuthentication();
  }

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    throw invalidAuthentication();
  }
  if (Buffer.byteLength(decoded) > MAX_AUTH_EVENT_BYTES) {
    throw invalidAuthentication();
  }

  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    throw invalidAuthentication();
  }
  if (!isEvent(value)) {
    throw invalidAuthentication();
  }

  return value;
}

function singleTag(event: Event, name: string): string | null {
  const values = event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1]);

  return values.length === 1 ? values[0] : null;
}

function verifySafely(event: Event): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}

function isEvent(value: unknown): value is Event {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    /^[a-f0-9]{64}$/.test(event.id) &&
    typeof event.pubkey === "string" &&
    /^[a-f0-9]{64}$/.test(event.pubkey) &&
    typeof event.sig === "string" &&
    /^[a-f0-9]{128}$/.test(event.sig) &&
    Number.isInteger(event.created_at) &&
    Number.isInteger(event.kind) &&
    typeof event.content === "string" &&
    Array.isArray(event.tags) &&
    event.tags.length <= 20 &&
    event.tags.every(
      (tag) =>
        Array.isArray(tag) &&
        tag.length >= 2 &&
        tag.length <= 4 &&
        tag.every((entry) => typeof entry === "string"),
    )
  );
}

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_BODY_BYTES)
  ) {
    throw new ApiError("invalid_input", "Request body is too large.", 413);
  }
  if (!request.body) {
    throw new ApiError("invalid_input", "Request body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ApiError("invalid_input", "Request body is too large.", 413);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ApiError("invalid_input", "Request body is invalid.");
  }
}

function invalidAuthentication(): ApiError {
  return new ApiError(
    "authentication_invalid",
    "Nostr authentication is invalid.",
    401,
  );
}
