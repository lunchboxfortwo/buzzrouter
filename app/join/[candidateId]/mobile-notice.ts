/**
 * Is this request coming from a phone or tablet browser?
 *
 * This is intentionally local to the join flow: it answers whether the current
 * browser is mobile, rather than which downloadable desktop build matches it.
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
 * A readable name for a community that never published one.
 *
 * 20 of 61 listed communities have no display name, and falling back to the
 * raw FQDN puts "Join creatormagic.communities.buzz.xyz" in an <h1>. Buzz's own
 * invite page does the same thing; that does not make it good. The first label
 * of the host is the name a human actually uses for the place.
 */
export function communityTitle(
  displayName: string | null | undefined,
  host: string,
): string {
  const named = displayName?.trim();
  if (named) return named;
  const [first] = host.split(".");
  return first && first.length > 1 ? first : host;
}

/**
 * What a phone visitor is told BEFORE they try to join.
 *
 * Every mobile route ends at the same wall, all measured 2026-08-02:
 *
 *  - "Open in Buzz": Buzz mobile cannot create an identity. Its only onboarding
 *    is "Scan a QR code from your desktop app" or "Use pairing code", so an
 *    unpaired phone silently swallows the buzz:// deep link.
 *  - "Continue on the web": Buzz's own hosted invite page offers exactly the
 *    same "Accept invite in Buzz" deep link, plus a "Download it now" link to
 *    an app that still cannot onboard standalone. Routing there relocates the
 *    dead end; it does not remove it.
 *  - Even a successful claim leaves the member in no channel at all
 *    (block/buzz#4307), so the app opens empty.
 *
 * So on a phone we do not pretend there is a path. We say to finish on a
 * computer and hand over the link to get there.
 */
export const MOBILE_JOIN_NOTICE = {
  title: "Finish this on a computer",
  body:
    "Buzz on a phone is a companion to Buzz on a desktop — it can't set up an " +
    "account by itself yet. Copy this link, open it on your computer, and join " +
    "from there. Pair your phone afterwards and this community comes with it.",
  copyLabel: "Copy link for later",
  copiedLabel: "Copied",
} as const;
