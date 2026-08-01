import { ApiError, apiErrorResponse } from "../http/api-error";
import { IDENTITY_SESSION_COOKIE } from "./store";

/** Best-effort client IP behind the Cloudflare tunnel. Mirrors the submissions route. */
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

/** Read the managed-identity session token from the request cookie header. */
export function readIdentityCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === IDENTITY_SESSION_COOKIE) {
      return rest.join("=") || null;
    }
  }
  return null;
}

/**
 * Build the Set-Cookie value for the session token. HttpOnly so client JS can
 * never read it; SameSite=Lax; Secure when served over https (Chromium treats
 * http://localhost as secure, so e2e still works).
 */
export function identitySessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const attrs = [
    `${IDENTITY_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Whether the public origin for this request is https. */
export function isSecureOrigin(request: Request): boolean {
  const origin = process.env.PUBLIC_APP_ORIGIN ?? new URL(request.url).origin;
  return origin.startsWith("https://");
}

const IDENTITY_FALLBACK = new ApiError(
  "identity_error",
  "The managed identity request failed.",
  500,
);

export function identityErrorResponse(error: unknown): Response {
  return apiErrorResponse(error, IDENTITY_FALLBACK);
}
