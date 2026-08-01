import { getDatabasePool } from "../../../src/db/pool";
import {
  clientIp,
  identityErrorResponse,
  identitySessionCookie,
  isSecureOrigin,
  readIdentityCookie,
} from "../../../src/managed-identity/http";
import { checkRateLimit } from "../../../src/managed-identity/rate-limit";
import {
  createManagedIdentity,
  getManagedIdentityPublic,
  mintIdentitySession,
  resolveIdentitySession,
} from "../../../src/managed-identity/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;

// Return the identity behind a valid session cookie, or null.
export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const token = readIdentityCookie(request);
    if (!token) {
      return Response.json({ identity: null }, { headers: noStore });
    }
    const ref = await resolveIdentitySession(pool, token).catch(() => null);
    if (!ref) {
      return Response.json({ identity: null }, { headers: noStore });
    }
    const identity = await getManagedIdentityPublic(pool, ref.identityId);
    return Response.json({ identity }, { headers: noStore });
  } catch (error) {
    return identityErrorResponse(error);
  }
}

// Ensure the caller has a managed identity: reuse the one behind their cookie,
// or mint a fresh keypair (rate-limited) and set a durable session cookie.
export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();

    const existing = readIdentityCookie(request);
    if (existing) {
      const ref = await resolveIdentitySession(pool, existing).catch(() => null);
      if (ref) {
        const identity = await getManagedIdentityPublic(pool, ref.identityId);
        return Response.json({ identity }, { headers: noStore });
      }
    }

    const ip = clientIp(request);
    const limit = checkRateLimit([
      { key: `create:ip:${ip}`, limit: 3, windowMs: 60_000 },
      { key: `create:ip-hour:${ip}`, limit: 10, windowMs: 3_600_000 },
      { key: "create:global", limit: 30, windowMs: 60_000 },
    ]);
    if (!limit.allowed) {
      return rateLimited(limit.retryAfterSeconds);
    }

    const ref = await createManagedIdentity(pool);
    const session = await mintIdentitySession(pool, ref.identityId);
    const identity = await getManagedIdentityPublic(pool, ref.identityId);
    return Response.json(
      { identity },
      {
        headers: {
          ...noStore,
          "set-cookie": identitySessionCookie(
            session.token,
            SESSION_COOKIE_MAX_AGE,
            isSecureOrigin(request),
          ),
        },
        status: 201,
      },
    );
  } catch (error) {
    return identityErrorResponse(error);
  }
}

const noStore = { "cache-control": "no-store" } as const;

function rateLimited(retryAfterSeconds: number | undefined): Response {
  return Response.json(
    { error: "rate_limited", retryAfterSeconds: retryAfterSeconds ?? null },
    {
      headers: {
        ...noStore,
        ...(retryAfterSeconds
          ? { "retry-after": String(retryAfterSeconds) }
          : {}),
      },
      status: 429,
    },
  );
}
