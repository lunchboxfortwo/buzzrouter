/**
 * Some Buzz invite codes are self-describing tokens shaped like
 * `<base64url-payload>.<signature>`, whose payload JSON carries `e` — the
 * invite's Unix-seconds expiry (verified empirically against real relay codes).
 * Others — notably the `v2.<opaque>` form — carry no readable expiry.
 *
 * Decoding `e` lets the freshness job act BEFORE the relay would reject the
 * code (swap in a longer-lived invite, or nudge the admin) rather than only
 * after a user has already hit a dead link. Pure and best-effort: anything that
 * is not a decodable expiry-bearing token returns null, and the caller falls
 * back to the live claim-probe as before.
 */

/** The invite's Unix-seconds expiry, or null when the code carries none. */
export function parseInviteExpiry(code: string): number | null {
  if (typeof code !== "string" || code.length === 0) return null;
  const payload = code.split(".")[0];
  if (!payload) return null;

  let json: string;
  try {
    // Tokens use base64url (`-_`, no padding); normalize to standard base64.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding =
      base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
    json = Buffer.from(base64 + padding, "base64").toString("utf8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(json) as { e?: unknown };
    if (
      typeof parsed.e === "number" &&
      Number.isFinite(parsed.e) &&
      parsed.e > 0
    ) {
      return Math.floor(parsed.e);
    }
  } catch {
    // Not a JSON payload (e.g. the `v2.<opaque>` form) — no readable expiry.
  }
  return null;
}

/**
 * True when `code` carries a readable expiry that falls within `withinSeconds`
 * of `nowSeconds` (or has already passed). A code with no readable expiry
 * returns false — its freshness can only be judged by the live probe.
 */
export function isExpiringSoon(
  code: string,
  nowSeconds: number,
  withinSeconds: number,
): boolean {
  const expiry = parseInviteExpiry(code);
  if (expiry === null) return false;
  return expiry - nowSeconds <= withinSeconds;
}
