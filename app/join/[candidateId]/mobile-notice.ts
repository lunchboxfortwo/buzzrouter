/**
 * Is this request coming from a phone or tablet browser?
 *
 * `app/create-community/platform.ts` deliberately maps Android to "unknown"
 * (it answers "which desktop build do I offer?"), so it cannot answer this.
 */
export function isMobileBrowser(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return (
    ua.includes("android") ||
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("ipod") ||
    // iPadOS reports as Macintosh but is touch-capable.
    (ua.includes("macintosh") && ua.includes("mobile"))
  );
}

/**
 * What a phone visitor is told before they try to join.
 *
 * Measured, not assumed — all three verified 2026-08-02:
 *
 *  - The claim itself works on any device: `POST /api/invites/claim` returns
 *    200 `{status:"joined"}` from a phone exactly as from a desktop.
 *  - Buzz's mobile app CANNOT create an identity. Its only onboarding is
 *    "Scan a QR code from your desktop app" or "Use pairing code", so a phone
 *    with no paired desktop has nothing to hand the invite to — the deep link
 *    is silently swallowed.
 *  - Even after a successful join, the new member belongs to no channel
 *    (block/buzz#4307), so the app opens on an empty community.
 *
 * So the honest message is NOT "joining does not work on mobile" — it does.
 * It is that reading and posting need Buzz on desktop first.
 */
export const MOBILE_JOIN_NOTICE = {
  title: "You'll need Buzz on desktop to read along",
  body:
    "Joining works from your phone, but the Buzz mobile app can't create an " +
    "account on its own — it pairs with Buzz on desktop. Set up desktop first, " +
    "then pair your phone, or carry on here and finish from a computer later.",
} as const;
