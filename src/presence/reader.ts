import type {
  Event,
  EventTemplate,
  VerifiedEvent,
} from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { finalizeEvent } from "nostr-tools/pure";
import {
  Relay,
  useWebSocketImplementation,
  type Subscription,
} from "nostr-tools/relay";
import { WebSocket as NodeWebSocket } from "ws";

import { loadAgentIdentity, type AgentIdentity } from "./identity";

/**
 * Reads public Buzz community activity. Every Buzz relay is NIP-42 auth-required
 * and NIP-29 group-based: the agent must sign a kind:22242 AUTH event before any
 * REQ succeeds. Community messages are kind:9 (`KIND_STREAM_MESSAGE`) scoped by
 * an `#h` tag = channel uuid; channel metadata/members are kinds 39000/39002.
 */

export const NIP42_AUTH_KIND = 22_242;
export const STREAM_MESSAGE_KIND = 9;
export const CHANNEL_METADATA_KIND = 39_000;
export const CHANNEL_ADMINS_KIND = 39_001;
export const CHANNEL_MEMBERS_KIND = 39_002;

const CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_READ_TIMEOUT_MS = 10_000;
const DEFAULT_READ_LIMIT = 200;
const MAX_WEBSOCKET_MESSAGE_BYTES = 512 * 1_024;
const HEX_EVENT_ID = /^[a-f0-9]{64}$/;

export interface ChannelMetadata {
  id: string;
  name?: string;
  about?: string;
  picture?: string;
  /** NIP-29 visibility: `public` readable metadata vs `private`. */
  isPublic: boolean;
  /** NIP-29 join policy: `open` (any member may read) vs `closed`. */
  isOpen: boolean;
  members: string[];
  isMember: boolean;
}

export interface PresenceMessage {
  id: string;
  channelId: string;
  pubkey: string;
  createdAt: number;
  content: string;
  parentId?: string;
}

export interface ConnectOptions {
  relayUrl: string;
  identity?: AgentIdentity;
  connectTimeoutMs?: number;
}

export interface ReadMessagesOptions {
  channelIds?: string[];
  limit?: number;
  since?: number;
  until?: number;
  timeoutMs?: number;
}

export interface SubscribeMessagesOptions {
  channelIds?: string[];
  since?: number;
  onMessage: (message: PresenceMessage) => void;
  onEose?: () => void;
  onClose?: (reason: string) => void;
}

export interface PresenceSubscription {
  close(): void;
}

export interface PresenceConnection {
  publicKeyHex: string;
  npub: string;
  publish(template: EventTemplate): Promise<VerifiedEvent>;
  enumerateChannels(options?: {
    timeoutMs?: number;
    limit?: number;
  }): Promise<ChannelMetadata[]>;
  readMessages(options?: ReadMessagesOptions): Promise<PresenceMessage[]>;
  subscribeMessages(
    options: SubscribeMessagesOptions,
  ): PresenceSubscription;
  close(): void;
}

export interface ReadCommunityOptions {
  relayUrl: string;
  channelIds?: string[];
  identity?: AgentIdentity;
  limit?: number;
  timeoutMs?: number;
  connectTimeoutMs?: number;
}

let webSocketConfigured = false;

function ensureWebSocketImplementation(): void {
  if (webSocketConfigured) return;
  class PresenceWebSocket extends NodeWebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, {
        maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
        perMessageDeflate: false,
      });
    }
  }
  useWebSocketImplementation(PresenceWebSocket);
  webSocketConfigured = true;
}

/**
 * Builds a signed NIP-42 AUTH event (kind:22242) with the canonical
 * `["relay", url]` / `["challenge", challenge]` tags. nostr-tools produces the
 * same shape internally during `relay.auth()`; this helper documents and
 * pins the contract the agent honors.
 */
export function buildAuthEvent(
  relayUrl: string,
  challenge: string,
  privateKey: Uint8Array,
  now = Math.floor(Date.now() / 1_000),
): VerifiedEvent {
  return finalizeEvent(
    {
      content: "",
      created_at: now,
      kind: NIP42_AUTH_KIND,
      tags: [
        ["relay", relayUrl],
        ["challenge", challenge],
      ],
    },
    privateKey,
  );
}

/** Parses a kind:9 stream message into a typed PresenceMessage, or null. */
export function presenceMessageFromEvent(
  event: Event,
): PresenceMessage | null {
  if (event.kind !== STREAM_MESSAGE_KIND) return null;
  const channelId = singleTagValue(event, "h");
  if (!channelId) return null;
  const message: PresenceMessage = {
    channelId,
    content: event.content,
    createdAt: event.created_at,
    id: event.id,
    pubkey: event.pubkey,
  };
  const parentId = replyEventId(event);
  if (parentId) message.parentId = parentId;
  return message;
}

/** Parses a kind:39000 group metadata event into ChannelMetadata, or null. */
export function parseChannelMetadata(
  event: Event,
): Omit<ChannelMetadata, "members" | "isMember"> | null {
  if (event.kind !== CHANNEL_METADATA_KIND) return null;
  const id = singleTagValue(event, "d");
  if (!id) return null;
  return {
    about: singleTagValue(event, "about") ?? undefined,
    id,
    isOpen: hasTag(event, "open"),
    isPublic: hasTag(event, "public"),
    name: singleTagValue(event, "name") ?? undefined,
    picture: singleTagValue(event, "picture") ?? undefined,
  };
}

/** Parses a kind:39002 members event into { id, members }, or null. */
export function parseChannelMembers(
  event: Event,
): { id: string; members: string[] } | null {
  if (event.kind !== CHANNEL_MEMBERS_KIND) return null;
  const id = singleTagValue(event, "d");
  if (!id) return null;
  const members = event.tags
    .filter((tag) => tag[0] === "p" && typeof tag[1] === "string")
    .map((tag) => tag[1]);
  return { id, members };
}

/**
 * Merges 39000 metadata with 39002 membership events into the accessible
 * channel list, flagging membership for the given agent pubkey.
 */
export function buildChannelIndex(
  events: Event[],
  agentPubkeyHex?: string,
): ChannelMetadata[] {
  const metadata = new Map<
    string,
    Omit<ChannelMetadata, "members" | "isMember">
  >();
  const memberships = new Map<string, string[]>();

  for (const event of events) {
    const meta = parseChannelMetadata(event);
    if (meta) {
      metadata.set(meta.id, meta);
      continue;
    }
    const members = parseChannelMembers(event);
    if (members) memberships.set(members.id, members.members);
  }

  return [...metadata.values()].map((meta) => {
    const members = memberships.get(meta.id) ?? [];
    return {
      ...meta,
      isMember: agentPubkeyHex ? members.includes(agentPubkeyHex) : false,
      members,
    };
  });
}

class RelayPresenceConnection implements PresenceConnection {
  constructor(
    private readonly relay: Relay,
    private readonly identity: AgentIdentity,
    private readonly relayUrl: string,
  ) {}

  get publicKeyHex(): string {
    return this.identity.publicKeyHex;
  }

  get npub(): string {
    return this.identity.npub;
  }

  async publish(template: EventTemplate): Promise<VerifiedEvent> {
    const event = finalizeEvent(
      template,
      this.identity.privateKey,
    ) as VerifiedEvent;
    try {
      await this.relay.publish(event);
    } catch (error) {
      if (!isAuthRequired(error)) throw error;
      await authenticate(this.relay, this.identity.privateKey);
      await this.relay.publish(event);
    }
    return event;
  }

  async enumerateChannels(options?: {
    timeoutMs?: number;
    limit?: number;
  }): Promise<ChannelMetadata[]> {
    const events = await this.collectUntilEose(
      [
        {
          kinds: [CHANNEL_METADATA_KIND, CHANNEL_MEMBERS_KIND],
          limit: options?.limit ?? 500,
        },
      ],
      options?.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    );
    return buildChannelIndex(events, this.identity.publicKeyHex);
  }

  async readMessages(
    options: ReadMessagesOptions = {},
  ): Promise<PresenceMessage[]> {
    const events = await this.collectUntilEose(
      [buildMessageFilter(options)],
      options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    );
    const messages: PresenceMessage[] = [];
    for (const event of events) {
      const message = presenceMessageFromEvent(event);
      if (message) messages.push(message);
    }
    messages.sort((a, b) => a.createdAt - b.createdAt);
    return messages;
  }

  subscribeMessages(
    options: SubscribeMessagesOptions,
  ): PresenceSubscription {
    const filter: Filter = { kinds: [STREAM_MESSAGE_KIND] };
    if (options.channelIds && options.channelIds.length > 0) {
      filter["#h"] = options.channelIds;
    }
    filter.since = options.since ?? Math.floor(Date.now() / 1_000);

    const subscription = this.relay.subscribe([filter], {
      onclose: (reason) => options.onClose?.(reason),
      oneose: () => options.onEose?.(),
      onevent: (event) => {
        const message = presenceMessageFromEvent(event);
        if (message) options.onMessage(message);
      },
    });
    return {
      close: () => subscription.close("presence subscription stopped"),
    };
  }

  close(): void {
    this.relay.close();
  }

  private collectUntilEose(
    filters: Filter[],
    timeoutMs: number,
  ): Promise<Event[]> {
    return new Promise((resolve) => {
      const events: Event[] = [];
      let settled = false;
      let subscription: Subscription | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        subscription?.close("collection complete");
        resolve(events);
      };
      const timer = setTimeout(finish, timeoutMs);
      subscription = this.relay.subscribe(filters, {
        onclose: finish,
        oneose: finish,
        onevent: (event) => events.push(event),
      });
    });
  }
}

/**
 * Opens a NIP-42 authenticated session to a Buzz relay using the agent key.
 * Mirrors the shared-channel connector: sets `onauth` and eagerly authenticates
 * so the very first REQ/EVENT is not rejected with `auth-required`.
 */
export async function connectToCommunity(
  options: ConnectOptions,
): Promise<PresenceConnection> {
  ensureWebSocketImplementation();
  const identity = options.identity ?? loadAgentIdentity();
  const relay = new Relay(options.relayUrl, {
    enablePing: true,
    enableReconnect: false,
    idleTimeout: 0,
  });
  relay.onauth = async (template: EventTemplate) =>
    finalizeEvent(template, identity.privateKey) as VerifiedEvent;

  await relay.connect({
    timeout: options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
  });
  await authenticate(relay, identity.privateKey);
  return new RelayPresenceConnection(relay, identity, options.relayUrl);
}

/**
 * Convenience wrapper: connect + NIP-42 auth, enumerate accessible channels
 * when none are supplied, read recent kind:9 messages until EOSE, then close.
 */
export async function readCommunity(
  options: ReadCommunityOptions,
): Promise<PresenceMessage[]> {
  const connection = await connectToCommunity({
    connectTimeoutMs: options.connectTimeoutMs,
    identity: options.identity,
    relayUrl: options.relayUrl,
  });
  try {
    let channelIds = options.channelIds;
    if (!channelIds || channelIds.length === 0) {
      const channels = await connection.enumerateChannels({
        timeoutMs: options.timeoutMs,
      });
      channelIds = channels.map((channel) => channel.id);
    }
    return await connection.readMessages({
      channelIds: channelIds.length > 0 ? channelIds : undefined,
      limit: options.limit,
      timeoutMs: options.timeoutMs,
    });
  } finally {
    connection.close();
  }
}

/**
 * Counts the distinct members across a community's channels — a best-effort
 * NIP-29 roster size drawn from the kind:39002 membership events. A member in
 * several channels is counted once.
 */
export function distinctMemberCount(channels: ChannelMetadata[]): number {
  const members = new Set<string>();
  for (const channel of channels) {
    for (const member of channel.members) members.add(member);
  }
  return members.size;
}

/**
 * Connects, enumerates channels, and returns the distinct member count across
 * the community (kind:39002 rosters). Optional/best-effort; used to thread
 * `totalMemberCount` into a community summary.
 */
export async function readMemberCount(
  options: ReadCommunityOptions,
): Promise<number> {
  const connection = await connectToCommunity({
    connectTimeoutMs: options.connectTimeoutMs,
    identity: options.identity,
    relayUrl: options.relayUrl,
  });
  try {
    const channels = await connection.enumerateChannels({
      timeoutMs: options.timeoutMs,
    });
    return distinctMemberCount(channels);
  } finally {
    connection.close();
  }
}

function buildMessageFilter(options: ReadMessagesOptions): Filter {
  const filter: Filter = {
    kinds: [STREAM_MESSAGE_KIND],
    limit: options.limit ?? DEFAULT_READ_LIMIT,
  };
  if (options.channelIds && options.channelIds.length > 0) {
    filter["#h"] = options.channelIds;
  }
  if (options.since !== undefined) filter.since = options.since;
  if (options.until !== undefined) filter.until = options.until;
  return filter;
}

/**
 * Best-effort NIP-42 auth. Relays that never issue a challenge do not require
 * auth and report that by throwing rather than hanging, so that case is
 * swallowed; every other failure propagates.
 */
async function authenticate(
  relay: Relay,
  privateKey: Uint8Array,
): Promise<void> {
  try {
    await relay.auth(
      async (template: EventTemplate) =>
        finalizeEvent(template, privateKey) as VerifiedEvent,
    );
  } catch (error) {
    if (isMissingChallenge(error)) return;
    throw error;
  }
}

function isAuthRequired(error: unknown): boolean {
  return error instanceof Error && /auth-required/i.test(error.message);
}

function isMissingChallenge(error: unknown): boolean {
  return error instanceof Error && /no challenge/i.test(error.message);
}

function singleTagValue(event: Event, name: string): string | null {
  const values = event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1]);
  return values.length >= 1 ? values[0] : null;
}

function hasTag(event: Event, name: string): boolean {
  return event.tags.some((tag) => tag[0] === name);
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
