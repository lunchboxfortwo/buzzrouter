import { getDatabasePool } from "../../../../src/db/pool";
import { ApiError } from "../../../../src/http/api-error";
import {
  clientIp,
  identityErrorResponse,
  readIdentityCookie,
} from "../../../../src/managed-identity/http";
import { checkRateLimit } from "../../../../src/managed-identity/rate-limit";
import {
  exportIdentityNsec,
  resolveIdentitySession,
} from "../../../../src/managed-identity/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reveal the nsec for export. This is the ONLY endpoint that returns key
// material, and it does so only to the authenticated owner of the session. The
// response is no-store so it is never cached; the client shows it once.
export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const token = readIdentityCookie(request);
    if (!token) {
      throw new ApiError(
        "identity_session_invalid",
        "No managed identity to export.",
        401,
      );
    }
    const ref = await resolveIdentitySession(pool, token);

    const ip = clientIp(request);
    const limit = checkRateLimit([
      { key: `export:pk:${ref.pubkey}`, limit: 5, windowMs: 60_000 },
      { key: `export:ip:${ip}`, limit: 10, windowMs: 60_000 },
    ]);
    if (!limit.allowed) {
      return Response.json(
        { error: "rate_limited" },
        { headers: { "cache-control": "no-store" }, status: 429 },
      );
    }

    const { npub, nsec } = await exportIdentityNsec(pool, ref.identityId);
    return Response.json(
      { npub, nsec },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return identityErrorResponse(error);
  }
}
