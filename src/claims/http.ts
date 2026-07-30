import type { Pool } from "pg";

import { ClaimError } from "./errors";
import {
  canonicalRequestUrl,
  consumeNip98Event,
  verifyNip98Authorization,
} from "./nip98";

const MAX_BODY_BYTES = 16 * 1_024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AuthenticatedRequestBody {
  pubkey: string;
  rawBody: string;
  value: unknown;
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
    throw new ClaimError("invalid_input", "Request body is invalid.");
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

export function claimErrorResponse(error: unknown): Response {
  const claimError =
    error instanceof ClaimError
      ? error
      : new ClaimError(
          "challenge_failed",
          "The claim request could not be completed.",
          500,
        );

  return Response.json(
    { error: claimError.code },
    {
      headers: { "cache-control": "no-store" },
      status: claimError.status,
    },
  );
}

export function requireUuid(value: unknown): string {
  if (!isUuid(value)) {
    throw new ClaimError("invalid_input", "Identifier is invalid.");
  }
  return value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function requireObject(
  value: unknown,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ClaimError("invalid_input", "Request body is invalid.");
  }
  return value as Record<string, unknown>;
}

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_BODY_BYTES)
  ) {
    throw new ClaimError("invalid_input", "Request body is too large.", 413);
  }
  if (!request.body) {
    throw new ClaimError("invalid_input", "Request body is required.");
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
      throw new ClaimError("invalid_input", "Request body is too large.", 413);
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
    throw new ClaimError("invalid_input", "Request body is invalid.");
  }
}
