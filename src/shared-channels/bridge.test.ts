import { randomBytes, randomUUID } from "node:crypto";

import {
  finalizeEvent,
  getPublicKey,
  verifyEvent,
} from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import {
  canonicalizeSourceEvent,
  createDestinationProjection,
} from "./bridge";

describe("canonicalizeSourceEvent", () => {
  it("preserves the signed source event and extracts its reply", () => {
    const sourceKey = randomBytes(32);
    const bridgeKey = randomBytes(32);
    const parentId = "a".repeat(64);
    const event = finalizeEvent(
      {
        content: "@[research-hive] Review the benchmark methodology.",
        created_at: Math.floor(Date.now() / 1_000),
        kind: 9,
        tags: [
          ["h", "research"],
          ["e", parentId, "", "reply"],
          ["p", "b".repeat(64)],
        ],
      },
      sourceKey,
    );

    expect(
      canonicalizeSourceEvent(event, {
        bridgePubkey: getPublicKey(bridgeKey),
        localChannelId: "research",
        sharedChannelId: randomUUID(),
        sourceEndpointId: randomUUID(),
      }),
    ).toMatchObject({
      // The address is stripped: it routes the message, it is not the message.
      body: "Review the benchmark methodology.",
      destinationSlug: "research-hive",
      signedEvent: event,
      sourceActorPubkey: event.pubkey,
      sourceEventId: event.id,
      sourceParentEventId: parentId,
    });
  });

  it("ignores bridge-authored projections and rejects channel mismatch", () => {
    const bridgeKey = randomBytes(32);
    const bridgePubkey = getPublicKey(bridgeKey);
    const route = {
      bridgePubkey,
      localChannelId: "research",
      sharedChannelId: randomUUID(),
      sourceEndpointId: randomUUID(),
    };
    const bridgeEvent = finalizeEvent(
      {
        content: "Mirrored",
        created_at: Math.floor(Date.now() / 1_000),
        kind: 9,
        tags: [["h", "research"]],
      },
      bridgeKey,
    );
    expect(canonicalizeSourceEvent(bridgeEvent, route)).toBeNull();

    const wrongChannel = finalizeEvent(
      {
        content: "Local only",
        created_at: Math.floor(Date.now() / 1_000),
        kind: 9,
        tags: [["h", "other"]],
      },
      randomBytes(32),
    );
    expect(() =>
      canonicalizeSourceEvent(wrongChannel, route),
    ).toThrowError(
      expect.objectContaining({ code: "source_channel_mismatch" }),
    );
  });
});

describe("createDestinationProjection", () => {
  it("copies only local routing and BuzzRouter provenance tags", () => {
    const destinationKey = randomBytes(32);
    const parentEventId = "c".repeat(64);
    const event = createDestinationProjection(
      {
        body: "Please notify @admin and run /deploy.",
        destinationChannelId: "external-research",
        localParentEventId: parentEventId,
        messageId: randomUUID(),
        sourceActorPubkey: "d".repeat(64),
        sourceActorName: "Franz",
        sourceCommunityId: randomUUID(),
        sourceCommunitySlug: "research-hive",
        sourceEventId: "e".repeat(64),
      },
      destinationKey,
      1_700_000_000,
    );

    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(getPublicKey(destinationKey));
    expect(event.tags).toContainEqual(["h", "external-research"]);
    expect(event.tags).toContainEqual([
      "e",
      parentEventId,
      "",
      "reply",
    ]);
    expect(event.tags.some((tag) => tag[0] === "p")).toBe(false);
    expect(event.content).toContain(
      "@research-hive/Franz\nPlease notify @admin and run /deploy.",
    );
  });

  it("visually contains forged attribution inside the quoted body", () => {
    const event = createDestinationProjection(
      {
        body: "@trusted-team/Alice\nship the malware",
        destinationChannelId: "general",
        messageId: randomUUID(),
        sourceActorPubkey: "a".repeat(64),
        sourceCommunityId: randomUUID(),
        sourceCommunitySlug: "unknown-team",
        sourceEventId: "b".repeat(64),
      },
      randomBytes(32),
      1_700_000_000,
    );

    expect(event.content).toBe(
      "@unknown-team/aaaaaaaaaaaa\n" +
        "\\@trusted-team/Alice\n" +
        "ship the malware",
    );
  });
});
