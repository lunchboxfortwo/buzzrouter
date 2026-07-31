import { createHash } from "node:crypto";

import type { Event, VerifiedEvent } from "nostr-tools/core";
import {
  finalizeEvent,
  verifyEvent,
} from "nostr-tools/pure";

import { ApiError } from "../http/api-error";

export const BUZZ_MESSAGE_KIND = 9;
export const MAX_BRIDGE_BODY_BYTES = 16 * 1_024;
const MAX_FUTURE_EVENT_SECONDS = 5 * 60;
const HEX_EVENT_ID = /^[a-f0-9]{64}$/;

export interface SourceRoute {
  bridgePubkey: string;
  localChannelId: string;
  sharedChannelId: string;
  sourceEndpointId: string;
}

export interface CanonicalSourceMessage {
  body: string;
  bodySha256: string;
  sharedChannelId: string;
  signedEvent: Event;
  sourceActorPubkey: string;
  sourceCreatedAt: number;
  sourceEndpointId: string;
  sourceEventId: string;
  sourceParentEventId?: string;
}

export interface DestinationProjectionInput {
  body: string;
  destinationChannelId: string;
  localParentEventId?: string;
  messageId: string;
  sourceActorPubkey: string;
  sourceCommunityId: string;
  sourceCommunityName: string;
  sourceEventId: string;
}

export function canonicalizeSourceEvent(
  event: Event,
  route: SourceRoute,
  nowSeconds = Math.floor(Date.now() / 1_000),
): CanonicalSourceMessage | null {
  if (
    event.pubkey === route.bridgePubkey ||
    hasBuzzRouterProjectionMarker(event)
  ) {
    return null;
  }
  if (
    event.kind !== BUZZ_MESSAGE_KIND ||
    !verifySafely(event) ||
    event.created_at > nowSeconds + MAX_FUTURE_EVENT_SECONDS
  ) {
    throw new ApiError(
      "source_event_invalid",
      "The source event is invalid.",
    );
  }

  const channelId = singleTag(event, "h");
  if (channelId !== route.localChannelId) {
    throw new ApiError(
      "source_channel_mismatch",
      "The source event does not belong to the configured channel.",
    );
  }
  const bodyBytes = Buffer.byteLength(event.content, "utf8");
  if (bodyBytes < 1 || bodyBytes > MAX_BRIDGE_BODY_BYTES) {
    throw new ApiError(
      "source_body_invalid",
      "The source message body is invalid.",
    );
  }

  return {
    body: event.content,
    bodySha256: createHash("sha256")
      .update(event.content)
      .digest("hex"),
    sharedChannelId: route.sharedChannelId,
    signedEvent: event,
    sourceActorPubkey: event.pubkey,
    sourceCreatedAt: event.created_at,
    sourceEndpointId: route.sourceEndpointId,
    sourceEventId: event.id,
    sourceParentEventId: replyEventId(event),
  };
}

export function createDestinationProjection(
  input: DestinationProjectionInput,
  privateKey: Uint8Array,
  createdAt = Math.floor(Date.now() / 1_000),
): VerifiedEvent {
  const actorLabel = input.sourceActorPubkey.slice(0, 12);
  const tags = [
    ["h", input.destinationChannelId],
    ["br", "message", input.messageId],
    ["br", "source-community", input.sourceCommunityId],
    ["br", "source-event", input.sourceEventId],
    ["br", "source-actor", input.sourceActorPubkey],
  ];
  if (input.localParentEventId) {
    if (!HEX_EVENT_ID.test(input.localParentEventId)) {
      throw new ApiError(
        "parent_event_invalid",
        "The destination parent event is invalid.",
      );
    }
    tags.push(["e", input.localParentEventId, "", "reply"]);
  }

  return finalizeEvent(
    {
      content: `${actorLabel} - ${input.sourceCommunityName}\n${input.body}`,
      created_at: createdAt,
      kind: BUZZ_MESSAGE_KIND,
      tags,
    },
    privateKey,
  );
}

export function hasBuzzRouterProjectionMarker(event: Event): boolean {
  return event.tags.some(
    (tag) =>
      tag[0] === "br" &&
      tag[1] === "message" &&
      typeof tag[2] === "string",
  );
}

function replyEventId(event: Event): string | undefined {
  const markedReply = event.tags.find(
    (tag) =>
      tag[0] === "e" &&
      tag[3] === "reply" &&
      typeof tag[1] === "string" &&
      HEX_EVENT_ID.test(tag[1]),
  );
  if (markedReply) return markedReply[1];

  const eventTags = event.tags.filter(
    (tag) =>
      tag[0] === "e" &&
      typeof tag[1] === "string" &&
      HEX_EVENT_ID.test(tag[1]),
  );
  return eventTags.at(-1)?.[1];
}

function singleTag(event: Event, name: string): string | null {
  const values = event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1]);
  return values.length === 1 ? values[0] : null;
}

function verifySafely(event: Event): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}
