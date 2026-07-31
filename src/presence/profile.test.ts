import type { EventTemplate, VerifiedEvent } from "nostr-tools/core";
import { finalizeEvent, generateSecretKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import { AGENT_PROFILE, buildProfileEvent, publishProfile } from "./profile";
import type { PresenceConnection } from "./reader";

const secret = generateSecretKey();

describe("buildProfileEvent", () => {
  it("builds a signed kind:0 event with the agent profile content", () => {
    const event = buildProfileEvent(secret);
    expect(event.kind).toBe(0);
    expect(verifyEvent(event)).toBe(true);
    expect(JSON.parse(event.content)).toEqual(AGENT_PROFILE);
    expect(AGENT_PROFILE.name).toBe("BuzzRouter Agent");
    expect(AGENT_PROFILE.website).toBe("https://buzzrouter.com");
  });
});

describe("publishProfile", () => {
  it("publishes a kind:0 template through the connection", async () => {
    let published: VerifiedEvent | undefined;
    const connection = {
      publish: async (template: EventTemplate) => {
        published = finalizeEvent(template, secret) as VerifiedEvent;
        return published;
      },
    } as unknown as PresenceConnection;

    const event = await publishProfile(connection);
    expect(event.kind).toBe(0);
    expect(published?.id).toBe(event.id);
    expect(JSON.parse(event.content)).toEqual(AGENT_PROFILE);
  });
});
