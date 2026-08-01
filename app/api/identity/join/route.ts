import { getDatabasePool } from "../../../../src/db/pool";
import { isUuid } from "../../../../src/claims/http";
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

    const input = readJoinRequest(await request.json().catch(() => null));

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
      candidateId: input.candidateId,
      identityId: ref.identityId,
      policyReceipt: input.policyReceipt,
    });
    return Response.json(
      { outcome },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return identityErrorResponse(error);
  }
}

function readJoinRequest(body: unknown): {
  candidateId: string;
  policyReceipt: string;
} {
  const input =
    body && typeof body === "object"
      ? (body as { candidateId?: unknown; policyReceipt?: unknown })
      : {};
  if (typeof input.candidateId !== "string" || !isUuid(input.candidateId)) {
    throw new ApiError("invalid_input", "A valid community id is required.");
  }
  if (
    typeof input.policyReceipt !== "string" ||
    input.policyReceipt.length === 0 ||
    input.policyReceipt.length > 4096
  ) {
    throw new ApiError("invalid_input", "A fresh join approval is required.");
  }
  return {
    candidateId: input.candidateId,
    policyReceipt: input.policyReceipt,
  };
}
