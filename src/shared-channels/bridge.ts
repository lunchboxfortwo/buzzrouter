import { createHash } from "node:crypto";

import type { Event, VerifiedEvent } from "nostr-tools/core";
import {
  finalizeEvent,
  verifyEvent,
} from "nostr-tools/pure";

import { ApiError } from "../http/api-error";
import { parseMessageAddress } from "./addressing";

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
  /** Destination community handle the author addressed, without the `@[]`. */
  destinationSlug: string;
  /** True when the author used the bracket form, i.e. unambiguous intent. */
  destinationExplicit: boolean;
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
  sourceActorName?: string | null;
  sourceCommunityId: string;
  sourceCommunitySlug: string;
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

  // Routing is opt-in per message. An unaddressed message is ordinary local
  // conversation that merely happens to sit in a channel the bridge can read,
  // and must never leave the community — so it is dropped here, exactly like
  // the bridge's own echoes above, rather than treated as an error.
  const address = parseMessageAddress(event.content);
  if (!address) return null;

  // The address is a routing header, not content: strip it so the destination
  // reads the message. An addressed user becomes a plain mention in the body —
  // it needs to survive to delivery time, and a column on bridge_messages would
  // be a schema change earning nothing that a leading `@name` does not.
  const routedBody = address.user
    ? `@${address.user} ${address.body}`
    : address.body;

  return {
    body: routedBody,
    bodySha256: createHash("sha256").update(routedBody).digest("hex"),
    destinationSlug: address.slug,
    destinationExplicit: address.explicit,
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
  const actorLabel =
    input.sourceActorName?.replace(/[\r\n\t]+/g, " ").trim().slice(0, 80) ||
    input.sourceActorPubkey.slice(0, 12);
  // Sending and receiving share one grammar: a message addressed with
  // `@community/user` arrives tagged `@community/user`, so what you read is
  // what you would type to reply. The previous form invented a third syntax
  // (`↳ @name · community`) that carried the same information and did not
  // round-trip.
  const attribution = `@${input.sourceCommunitySlug}/${actorLabel}`;
  // Names are user-controlled, so a body line that imitates this header must be
  // escaped or anyone could forge an attribution inside their own message.
  const attributionShape = /^@[a-z0-9-]{2,40}\/.{1,80}$/u;
  const escapedBody = input.body
    .split("\n")
    .map((line) => (attributionShape.test(line) ? `\\${line}` : line))
    .join("\n");
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
      content: `${attribution}\n${escapedBody}`,
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
