import { getDatabasePool } from "../../../../src/db/pool";
import { ApiError } from "../../../../src/http/api-error";
import {
  clientIp,
  identityErrorResponse,
  readIdentityCookie,
} from "../../../../src/managed-identity/http";
import { joinCommunityWithManagedIdentity } from "../../../../src/managed-identity/join";
import { checkRateLimit } from "../../../../src/managed-identity/rate-limit";
import { resolveIdentitySession } from "../../../../src/managed-identity/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-action click-to-join with the caller's managed identity. Requires the
// session cookie. Rate-limited per identity (well under the upstream 10/60s per
// pubkey), per IP, and globally, so we never amplify claim traffic against
// other people's communities. Always returns a structured outcome the UI can
// render — a refused claim is a result, not an error to retry.
export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const token = readIdentityCookie(request);
    if (!token) {
      throw new ApiError(
        "identity_session_invalid",
        "Get a managed identity first.",
        401,
      );
    }
    const ref = await resolveIdentitySession(pool, token);

    const relayHost = readRelayHost(await request.json().catch(() => null));

    const ip = clientIp(request);
    const limit = checkRateLimit([
      { key: `join:pk:${ref.pubkey}`, limit: 5, windowMs: 60_000 },
      { key: `join:ip:${ip}`, limit: 10, windowMs: 60_000 },
      { key: "join:global", limit: 60, windowMs: 60_000 },
    ]);
    if (!limit.allowed) {
      return Response.json(
        { error: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds ?? null },
        {
          headers: {
            "cache-control": "no-store",
            ...(limit.retryAfterSeconds
              ? { "retry-after": String(limit.retryAfterSeconds) }
              : {}),
          },
          status: 429,
        },
      );
    }

    const outcome = await joinCommunityWithManagedIdentity(pool, {
      identityId: ref.identityId,
      relayHost,
    });
    return Response.json(
      { outcome },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return identityErrorResponse(error);
  }
}

function readRelayHost(body: unknown): string {
  const value =
    body && typeof body === "object"
      ? (body as { relayHost?: unknown }).relayHost
      : undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 253) {
    throw new ApiError("invalid_input", "A community host is required.");
  }
  // Bare host only — no scheme, path, or whitespace. The server resolves the
  // actual relay URL and pins the claim to it; this is just the directory key.
  const host = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)) {
    throw new ApiError("invalid_input", "The community host is invalid.");
  }
  return host;
}
