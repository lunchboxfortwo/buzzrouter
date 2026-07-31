import { randomBytes, randomUUID } from "node:crypto";

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import {
  buildAuthEvent,
  buildChannelIndex,
  CHANNEL_MEMBERS_KIND,
  CHANNEL_METADATA_KIND,
  NIP42_AUTH_KIND,
  parseChannelMembers,
  parseChannelMetadata,
  presenceMessageFromEvent,
  STREAM_MESSAGE_KIND,
} from "./reader";

const secret = generateSecretKey();

describe("buildAuthEvent", () => {
  it("produces a signed kind:22242 event with relay and challenge tags", () => {
    const relayUrl = "wss://relay.example.com";
    const challenge = "challenge-token-123";
    const event = buildAuthEvent(relayUrl, challenge, secret);

    expect(event.kind).toBe(NIP42_AUTH_KIND);
    expect(event.kind).toBe(22_242);
    expect(event.content).toBe("");
    expect(verifyEvent(event)).toBe(true);
    expect(event.tags).toContainEqual(["relay", relayUrl]);
    expect(event.tags).toContainEqual(["challenge", challenge]);
  });
});

describe("presenceMessageFromEvent", () => {
  it("parses a kind:9 stream message scoped by its #h tag", () => {
    const channelId = randomUUID();
    const event = finalizeEvent(
      {
        content: "gm from the community",
        created_at: 1_785_000_000,
        kind: STREAM_MESSAGE_KIND,
        tags: [["h", channelId]],
      },
      secret,
    );
    expect(presenceMessageFromEvent(event)).toEqual({
      channelId,
      content: "gm from the community",
      createdAt: 1_785_000_000,
      id: event.id,
      pubkey: getPublicKey(secret),
    });
  });

  it("extracts the reply parent from a marked e-tag", () => {
    const channelId = randomUUID();
    const parentId = "a".repeat(64);
    const event = finalizeEvent(
      {
        content: "reply body",
        created_at: 1_785_000_100,
        kind: STREAM_MESSAGE_KIND,
        tags: [
          ["h", channelId],
          ["e", parentId, "", "reply"],
        ],
      },
      secret,
    );
    expect(presenceMessageFromEvent(event)?.parentId).toBe(parentId);
  });

  it("returns null for the wrong kind or a missing channel tag", () => {
    const noChannel = finalizeEvent(
      {
        content: "orphan",
        created_at: 1_785_000_200,
        kind: STREAM_MESSAGE_KIND,
        tags: [],
      },
      secret,
    );
    expect(presenceMessageFromEvent(noChannel)).toBeNull();

    const wrongKind = finalizeEvent(
      {
        content: "reaction",
        created_at: 1_785_000_300,
        kind: 7,
        tags: [["h", randomUUID()]],
      },
      secret,
    );
    expect(presenceMessageFromEvent(wrongKind)).toBeNull();
  });
});

describe("parseChannelMetadata / parseChannelMembers", () => {
  const channelId = randomUUID();

  it("parses 39000 metadata with visibility flags", () => {
    const event = finalizeEvent(
      {
        content: "",
        created_at: 1_785_000_000,
        kind: CHANNEL_METADATA_KIND,
        tags: [
          ["d", channelId],
          ["name", "General"],
          ["about", "The main channel"],
          ["public"],
          ["open"],
        ],
      },
      secret,
    );
    expect(parseChannelMetadata(event)).toEqual({
      about: "The main channel",
      id: channelId,
      isOpen: true,
      isPublic: true,
      name: "General",
      picture: undefined,
    });
  });

  it("treats missing visibility tags as private/closed", () => {
    const event = finalizeEvent(
      {
        content: "",
        created_at: 1_785_000_000,
        kind: CHANNEL_METADATA_KIND,
        tags: [
          ["d", channelId],
          ["name", "Secret"],
        ],
      },
      secret,
    );
    expect(parseChannelMetadata(event)).toMatchObject({
      isOpen: false,
      isPublic: false,
    });
  });

  it("parses 39002 member p-tags", () => {
    const memberA = getPublicKey(randomBytes(32));
    const memberB = getPublicKey(randomBytes(32));
    const event = finalizeEvent(
      {
        content: "",
        created_at: 1_785_000_000,
        kind: CHANNEL_MEMBERS_KIND,
        tags: [
          ["d", channelId],
          ["p", memberA],
          ["p", memberB],
        ],
      },
      secret,
    );
    expect(parseChannelMembers(event)).toEqual({
      id: channelId,
      members: [memberA, memberB],
    });
  });
});

describe("buildChannelIndex", () => {
  it("merges metadata with membership and flags the agent", () => {
    const channelId = randomUUID();
    const agentPubkey = getPublicKey(secret);
    const metadata = finalizeEvent(
      {
        content: "",
        created_at: 1_785_000_000,
        kind: CHANNEL_METADATA_KIND,
        tags: [
          ["d", channelId],
          ["name", "General"],
          ["public"],
          ["open"],
        ],
      },
      secret,
    );
    const members = finalizeEvent(
      {
        content: "",
        created_at: 1_785_000_000,
        kind: CHANNEL_MEMBERS_KIND,
        tags: [
          ["d", channelId],
          ["p", agentPubkey],
        ],
      },
      secret,
    );

    expect(buildChannelIndex([metadata, members], agentPubkey)).toEqual([
      {
        about: undefined,
        id: channelId,
        isMember: true,
        isOpen: true,
        isPublic: true,
        members: [agentPubkey],
        name: "General",
        picture: undefined,
      },
    ]);
  });

  it("reports non-membership when the agent is absent", () => {
    const channelId = randomUUID();
    const metadata = finalizeEvent(
      {
        content: "",
        created_at: 1_785_000_000,
        kind: CHANNEL_METADATA_KIND,
        tags: [["d", channelId]],
      },
      secret,
    );
    const [channel] = buildChannelIndex(
      [metadata],
      getPublicKey(secret),
    );
    expect(channel.isMember).toBe(false);
    expect(channel.members).toEqual([]);
  });
});
