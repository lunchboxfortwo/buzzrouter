/**
 * In-chat slash commands for direct channels.
 *
 * Buzz has no native slash-command support, so a `/`-command is an ordinary
 * kind-9 message the bridge reads off the channel feed and acts on before
 * routing. This module is the pure parser for that grammar; the connector
 * intercepts anything it recognises and never mirrors it.
 *
 * The grammar is deliberately tiny and strict:
 *   - `/open <community>`  — create a direct channel to <community>.
 *   - `/close <community>` — unbind the direct channel to <community>.
 *   - `/close`             — unbind the direct channel the command is typed in.
 *   - `/list`              — list direct channels and inbound communities.
 *
 * Only `/` + a KNOWN verb is a command; every other message — including a
 * leading `/` with an unknown verb — is ordinary chat and returns null, so the
 * bridge never replies to a stray slash. A known verb with a missing or
 * malformed argument is a `usage` result, which is a command (the bridge
 * replies) rather than silence, so `/open` with no community is never a no-op.
 */

/** A community handle, matching `communities.slug` and the addressing parser. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

export const COMMAND_USAGE =
  "BuzzRouter commands: /open <community>, /close [<community>], /list.";

export type ParsedCommand =
  | { kind: "open"; slug: string }
  | { kind: "close"; slug: string | null }
  | { kind: "list" }
  | { kind: "usage"; message: string };

/**
 * Parse a message body as a slash command.
 *
 * Returns null when the message is not a command (the common case: ordinary
 * chat, or a leading slash whose verb we do not know). Returns a `usage` result
 * when a known verb is used with a bad argument, so the caller can reply with
 * help instead of doing nothing.
 */
export function parseCommand(content: string): ParsedCommand | null {
  if (typeof content !== "string") return null;
  const tokens = content.trim().split(/\s+/);
  const head = tokens[0] ?? "";
  if (!head.startsWith("/")) return null;

  const verb = head.slice(1).toLowerCase();
  const arg = tokens[1];

  switch (verb) {
    case "open": {
      const slug = normalizeSlug(arg);
      if (!slug) {
        return { kind: "usage", message: `Usage: /open <community>. ${COMMAND_USAGE}` };
      }
      return { kind: "open", slug };
    }
    case "close": {
      if (arg === undefined) return { kind: "close", slug: null };
      const slug = normalizeSlug(arg);
      if (!slug) {
        return { kind: "usage", message: `Usage: /close [<community>]. ${COMMAND_USAGE}` };
      }
      return { kind: "close", slug };
    }
    case "list":
      return { kind: "list" };
    default:
      // A `/` with a verb we do not handle is not our command — leave it as chat
      // rather than replying to every stray slash a user might type.
      return null;
  }
}

function normalizeSlug(arg: string | undefined): string | null {
  if (arg === undefined) return null;
  const slug = arg.trim().toLowerCase();
  return SLUG.test(slug) ? slug : null;
}
