import type { EventTemplate, VerifiedEvent } from "nostr-tools/core";
import { finalizeEvent } from "nostr-tools/pure";

import type { PresenceConnection } from "./reader";

/**
 * Publishes the agent's public NIP-01 profile (kind:0). This is how a community
 * sees who the BuzzRouter agent is and what it does when it appears in member
 * lists and message history.
 */

export const PROFILE_KIND = 0;

export const AGENT_PROFILE = {
  about:
    "Automated agent for the BuzzRouter public community directory — reads " +
    "public activity to summarize it on buzzrouter.com.",
  name: "BuzzRouter Agent",
  website: "https://buzzrouter.com",
} as const;

/** Builds the unsigned kind:0 profile template. */
export function buildProfileTemplate(
  now = Math.floor(Date.now() / 1_000),
): EventTemplate {
  return {
    content: JSON.stringify(AGENT_PROFILE),
    created_at: now,
    kind: PROFILE_KIND,
    tags: [],
  };
}

/** Builds a signed kind:0 profile event for the given key. */
export function buildProfileEvent(
  privateKey: Uint8Array,
  now?: number,
): VerifiedEvent {
  return finalizeEvent(buildProfileTemplate(now), privateKey);
}

/** Publishes the agent profile over an authenticated presence connection. */
export async function publishProfile(
  connection: PresenceConnection,
): Promise<VerifiedEvent> {
  return connection.publish(buildProfileTemplate());
}
