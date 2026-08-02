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
      ageConfirmed: input.ageConfirmed,
      candidateId: input.candidateId,
      identityId: ref.identityId,
      policyVersion: input.policyVersion,
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
  ageConfirmed: boolean;
  candidateId: string;
  policyVersion: string;
} {
  const input =
    body && typeof body === "object"
      ? (body as {
          ageConfirmed?: unknown;
          candidateId?: unknown;
          policyVersion?: unknown;
        })
      : {};
  if (typeof input.candidateId !== "string" || !isUuid(input.candidateId)) {
    throw new ApiError("invalid_input", "A valid community id is required.");
  }
  if (
    typeof input.ageConfirmed !== "boolean" ||
    typeof input.policyVersion !== "string" ||
    input.policyVersion.length === 0 ||
    input.policyVersion.length > 256
  ) {
    throw new ApiError("invalid_input", "Fresh join consent is required.");
  }
  return {
    ageConfirmed: input.ageConfirmed,
    candidateId: input.candidateId,
    policyVersion: input.policyVersion,
  };
}
