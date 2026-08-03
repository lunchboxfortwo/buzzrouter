/**
 * Message addressing for the router.
 *
 * BuzzRouter routes; it does not broadcast. A message only leaves its community
 * when the author addresses it, by opening the body with `@[destination]` or
 * `@[destination/user]`. Everything else is ordinary local chat that happens to
 * sit in a channel we can read, and must never be mirrored anywhere.
 *
 * This is addressing, not application semantics: the layer learns WHERE a
 * message goes, never WHAT it means. PRODUCT.md's no-semantics rule forbids the
 * transport understanding job types, request schemas, or status enums — a
 * destination is the same kind of thing as a TCP port, and is allowed.
 */

/** A community handle: `communities.slug`. Lowercase, url-safe, 2–40 chars. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** A user handle is only ever echoed as a mention, so keep it conservative. */
const USER = /^[a-zA-Z0-9_.-]{1,64}$/;

export type MessageAddress = {
  /** Destination community slug, lowercased. */
  slug: string;
  /** Optional user handle to mention in the destination. */
  user?: string;
  /** The message with the address prefix removed. */
  body: string;
};

/**
 * Parse a leading `@[slug]` / `@[slug/user]` address.
 *
 * Returns null for anything unaddressed, which is the common case and MUST be
 * treated as "do not route" rather than as an error — a community's channel is
 * mostly ordinary conversation.
 */
export function parseMessageAddress(body: string): MessageAddress | null {
  const match = /^\s*@\[([^\]\s]{1,120})\]\s*/u.exec(body);
  if (!match) return null;

  const target = match[1]!;
  const separator = target.indexOf("/");
  const rawSlug = (separator === -1 ? target : target.slice(0, separator))
    .trim()
    .toLowerCase();
  const rawUser =
    separator === -1 ? undefined : target.slice(separator + 1).trim();

  if (!SLUG.test(rawSlug)) return null;
  if (rawUser !== undefined && !USER.test(rawUser)) return null;

  // Strip the address itself. The remainder is what the destination sees, so a
  // bare address with no text is not a message worth delivering.
  const remainder = body.slice(match[0].length);
  if (remainder.trim().length === 0) return null;

  return {
    slug: rawSlug,
    ...(rawUser === undefined ? {} : { user: rawUser }),
    body: remainder,
  };
}
