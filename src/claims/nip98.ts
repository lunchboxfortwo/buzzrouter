import { createHash } from "node:crypto";

import type { Event } from "nostr-tools/core";
import { verifyEvent } from "nostr-tools/pure";
import type { Pool } from "pg";

import { ClaimError } from "./errors";

const NIP98_KIND = 27_235;
const AUTH_WINDOW_SECONDS = 60;
const MAX_AUTH_EVENT_BYTES = 16 * 1_024;

export interface NostrIdentity {
  createdAt: number;
  eventId: string;
  pubkey: string;
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
    throw new ClaimError(
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
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && origin.protocol === "http:"))
  ) {
    throw new Error("PUBLIC_APP_ORIGIN must be an HTTPS origin.");
  }

  return new URL(pathAndSearch, origin).toString();
}

function parseAuthorizationEvent(authorization: string | null): Event {
  if (!authorization?.startsWith("Nostr ")) {
    throw new ClaimError(
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

function invalidAuthentication(): ClaimError {
  return new ClaimError(
    "authentication_invalid",
    "Nostr authentication is invalid.",
    401,
  );
}
