/**
 * Format guard for Buzz invite codes.
 *
 * Real codes minted by Buzz relays come in exactly two shapes (census of all
 * 27 directory codes, 2026-08-03 — plus every code observed in harvesting):
 *
 *   - `eyJ…`  — base64url JSON `{c,r,e,n}` payload, usually followed by a
 *               `.signature` part (`eyJ` is base64url for `{"`).
 *   - `vN.…`  — versioned opaque HMAC token (`v2.` today; `v\d+` so a future
 *               version bump keeps matching).
 *
 * The guard exists because harvested "codes" have reached the directory as
 * bare community names/slugs (`eco`, `Wailyn`, `virtualoranges`, …) — every
 * one confirmed `invite_invalid` against its relay — and an invalid stored
 * code renders a join button that cannot work. A malformed code is dropped at
 * ingest (`normalizeCandidateSourceListing`) and filtered at read
 * (`directory.ts` / `join-probes.ts`), so it can never surface as joinable.
 *
 * Fails closed by design: if Buzz ever ships a third format, those codes are
 * hidden (community stays listed without a join button) rather than shown
 * broken — loosen the pattern here when that happens.
 *
 * Import-free so client components can share it.
 */

/** Matches a plausibly-real Buzz invite code; see module docs for the census. */
export const BUZZ_INVITE_CODE_RE = /^(?:eyJ|v\d+[.])[A-Za-z0-9._~-]{8,}$/;

/**
 * POSIX-ERE twin of `BUZZ_INVITE_CODE_RE` for Postgres `~` predicates.
 * KEEP IN SYNC with the RegExp above (`invite-code-format.test.ts` asserts
 * they agree on the fixture set).
 */
export const BUZZ_INVITE_CODE_SQL_RE = "^(eyJ|v[0-9]+[.])[A-Za-z0-9._~-]{8,}$";

/** True when `code` has the shape of a real Buzz invite code. */
export function isBuzzInviteCode(code: string): boolean {
  return BUZZ_INVITE_CODE_RE.test(code);
}
