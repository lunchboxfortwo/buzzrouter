import { randomBytes } from "node:crypto";

import type { Event, EventTemplate } from "nostr-tools/core";
import { finalizeEvent } from "nostr-tools/pure";
import type { Pool } from "pg";

import { ApiError } from "../http/api-error";
import {
  createFileWrappingKeyProvider,
  createRelayConnectionFactory,
  type RelayConnection,
  type RelayConnectionFactory,
  type WrappingKeyProvider,
} from "./connector";
import {
  decryptConnectorPrivateKey,
  getOwnedCommunityConnection,
  type OwnedConnectorConnection,
} from "./store";

// NIP-29 group management kinds, verified against Buzz's source (see task
// brief): 9007 CREATES a group and makes its author the owner; 9000 puts a user
// into a group with a role, which only an owner/admin may do. The bridge is the
// creator, so it is momentarily the owner and may issue the 9000s below.
const GROUP_CREATE_KIND = 9_007;
const GROUP_PUT_USER_KIND = 9_000;

// The requester (the human who asked for the link) is promoted to owner; the
// bot then steps itself down to a plain member so it never lingers as the owner
// of a channel inside someone else's community.
const REQUESTER_ROLE = "owner";
const BOT_ROLE = "member";

const CREATE_CONFIRM_TIMEOUT_MS = 3_000;

export interface CreateDedicatedChannelInput {
  communityId: string;
  /** The human who requested the link — receives ownership of the new channel. */
  ownerPubkey: string;
  /** The peer community; the channel is named after it so it is self-describing. */
  peerName: string;
  idempotencyKey: string;
}

export interface DedicatedChannel {
  channelId: string;
  channelName: string;
}

export type ChannelHandoffState =
  | "creating"
  | "created"
  | "handed_off"
  | "completed";

export interface ChannelHandoffRecord {
  attempts: number;
  channelId: string;
  channelName: string;
  communityId: string;
  connectionId: string;
  id: string;
  lastError: string | null;
  relayUrl: string;
  requesterPubkey: string;
  state: ChannelHandoffState;
}

interface HandoffRow {
  attempts: number;
  channel_id: string;
  channel_name: string;
  community_id: string;
  connection_id: string;
  id: string;
  last_error: string | null;
  relay_url_snapshot: string;
  requester_pubkey: string;
  state: ChannelHandoffState;
}

/**
 * Create a dedicated NIP-29 channel for one shared-channel link and hand its
 * ownership to the requester, so linking never requires a hand-made channel and
 * the `(community_id, local_channel_id)` unique index is satisfied by a fresh
 * channel every time.
 *
 * The create → promote → demote sequence is three relay round trips; a failure
 * after creation would leave the bot owning a channel the community did not ask
 * for. The whole sequence is therefore journaled in `bridge_channel_handoffs`
 * and this call is RESUMABLE: invoked again with the same idempotency key it
 * reuses the same channel and finishes whatever steps are left. It throws a
 * clear product error (never a raw failure) when it cannot complete, leaving the
 * row in a retryable state.
 */
export async function createDedicatedChannel(
  pool: Pool,
  input: CreateDedicatedChannelInput,
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
  relayFactory: RelayConnectionFactory = createRelayConnectionFactory(),
): Promise<DedicatedChannel> {
  const channelName = normalizeChannelName(input.peerName);
  assertIdempotencyKey(input.idempotencyKey);

  const connection = await getOwnedCommunityConnection(pool, {
    communityId: input.communityId,
    ownerPubkey: input.ownerPubkey,
  });
  if (!connection) {
    throw new ApiError(
      "connection_required",
      "The community connector must be active before creating a channel.",
      409,
    );
  }

  const handoff = await reserveHandoff(pool, {
    channelName,
    connection,
    idempotencyKey: input.idempotencyKey,
    requesterPubkey: input.ownerPubkey,
  });
  if (handoff.state === "completed") {
    return { channelId: handoff.channelId, channelName: handoff.channelName };
  }

  const wrappingKey = await wrappingKeys.getKey(connection.wrappingKeyVersion);
  const privateKey = decryptConnectorPrivateKey(
    connection,
    wrappingKey,
    connection.communityId,
  );
  let relay: RelayConnection | undefined;
  try {
    relay = await relayFactory.connect(connection.relayUrl, privateKey);
    await runHandoff(pool, relay, privateKey, connection.bridgePubkey, handoff);
    return { channelId: handoff.channelId, channelName: handoff.channelName };
  } finally {
    relay?.close();
    privateKey.fill(0);
  }
}

/**
 * Drive whatever steps of the create → promote → demote sequence remain for
 * `handoff`, advancing its journaled state after each. On any failure it records
 * the error against the row (leaving state where it got to, so a later call
 * resumes) and rethrows a clear product error.
 */
async function runHandoff(
  pool: Pool,
  relay: RelayConnection,
  privateKey: Uint8Array,
  botPubkey: string,
  handoff: ChannelHandoffRecord,
): Promise<void> {
  if (handoff.state === "creating") {
    await runStep(pool, handoff, "channel_create_failed", async () => {
      await publishConfirmed(
        relay,
        finalize(privateKey, {
          content: "",
          kind: GROUP_CREATE_KIND,
          tags: [
            ["h", handoff.channelId],
            ["name", handoff.channelName],
          ],
        }),
      );
    });
    await advanceHandoff(pool, handoff, "creating", "created");
  }

  if (handoff.state === "created") {
    await runStep(pool, handoff, "channel_handoff_incomplete", async () => {
      await publishConfirmed(
        relay,
        finalize(privateKey, putUserTemplate(
          handoff.channelId,
          handoff.requesterPubkey,
          REQUESTER_ROLE,
        )),
      );
    });
    await advanceHandoff(pool, handoff, "created", "handed_off");
  }

  if (handoff.state === "handed_off") {
    await runStep(pool, handoff, "channel_handoff_incomplete", async () => {
      await publishConfirmed(
        relay,
        finalize(privateKey, putUserTemplate(
          handoff.channelId,
          botPubkey,
          BOT_ROLE,
        )),
      );
    });
    await advanceHandoff(pool, handoff, "handed_off", "completed");
  }
}

async function runStep(
  pool: Pool,
  handoff: ChannelHandoffRecord,
  errorCode: string,
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    await recordHandoffError(pool, handoff.id, errorCode);
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      errorCode,
      errorCode === "channel_create_failed"
        ? "The new channel could not be created on your relay."
        : "The channel was created but ownership could not be transferred. Try again.",
      502,
      { cause: error },
    );
  }
}

function putUserTemplate(
  channelId: string,
  pubkey: string,
  role: string,
): Omit<EventTemplate, "created_at"> {
  return {
    content: "",
    kind: GROUP_PUT_USER_KIND,
    tags: [
      ["h", channelId],
      ["p", pubkey, role],
    ],
  };
}

function finalize(
  privateKey: Uint8Array,
  template: Omit<EventTemplate, "created_at">,
): Event {
  return finalizeEvent(
    { ...template, created_at: Math.floor(Date.now() / 1_000) },
    privateKey,
  );
}

/**
 * Publish an event and confirm the relay actually stored it, so an accepted OK
 * that the relay silently drops is treated as a failure rather than success.
 */
async function publishConfirmed(
  relay: RelayConnection,
  event: Event,
): Promise<void> {
  await relay.publish(event);
  const deadline = Date.now() + CREATE_CONFIRM_TIMEOUT_MS;
  for (;;) {
    if (await relay.hasEvent(event.id)) return;
    if (Date.now() >= deadline) {
      throw new ApiError(
        "channel_event_not_stored",
        "The relay did not retain the channel event.",
        502,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function reserveHandoff(
  pool: Pool,
  input: {
    channelName: string;
    connection: OwnedConnectorConnection;
    idempotencyKey: string;
    requesterPubkey: string;
  },
): Promise<ChannelHandoffRecord> {
  const result = await pool.query<HandoffRow>(
    `
      INSERT INTO bridge_channel_handoffs (
        connection_id,
        community_id,
        requester_pubkey,
        relay_url_snapshot,
        channel_id,
        channel_name,
        idempotency_key
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (requester_pubkey, idempotency_key)
        DO UPDATE SET updated_at = now()
      RETURNING
        id,
        connection_id,
        community_id,
        requester_pubkey,
        relay_url_snapshot,
        channel_id,
        channel_name,
        state,
        attempts,
        last_error
    `,
    [
      input.connection.id,
      input.connection.communityId,
      input.requesterPubkey,
      input.connection.relayUrl,
      deriveChannelId(input.channelName),
      input.channelName,
      input.idempotencyKey,
    ],
  );
  return mapHandoff(result.rows[0]);
}

async function advanceHandoff(
  pool: Pool,
  handoff: ChannelHandoffRecord,
  from: ChannelHandoffState,
  to: ChannelHandoffState,
): Promise<void> {
  await pool.query(
    `
      UPDATE bridge_channel_handoffs
      SET state = $3, last_error = NULL, updated_at = now()
      WHERE id = $1 AND state = $2
    `,
    [handoff.id, from, to],
  );
  handoff.state = to;
}

async function recordHandoffError(
  pool: Pool,
  id: string,
  code: string,
): Promise<void> {
  await pool.query(
    `
      UPDATE bridge_channel_handoffs
      SET attempts = attempts + 1, last_error = $2, updated_at = now()
      WHERE id = $1
    `,
    [id, code.slice(0, 200)],
  );
}

/** Inspect a persisted handoff — used by tests and diagnostics. */
export async function getChannelHandoff(
  pool: Pool,
  input: { idempotencyKey: string; requesterPubkey: string },
): Promise<ChannelHandoffRecord | null> {
  const result = await pool.query<HandoffRow>(
    `
      SELECT
        id,
        connection_id,
        community_id,
        requester_pubkey,
        relay_url_snapshot,
        channel_id,
        channel_name,
        state,
        attempts,
        last_error
      FROM bridge_channel_handoffs
      WHERE requester_pubkey = $1 AND idempotency_key = $2
    `,
    [input.requesterPubkey, input.idempotencyKey],
  );
  return result.rows[0] ? mapHandoff(result.rows[0]) : null;
}

function mapHandoff(row: HandoffRow): ChannelHandoffRecord {
  return {
    attempts: row.attempts,
    channelId: row.channel_id,
    channelName: row.channel_name,
    communityId: row.community_id,
    connectionId: row.connection_id,
    id: row.id,
    lastError: row.last_error,
    relayUrl: row.relay_url_snapshot,
    requesterPubkey: row.requester_pubkey,
    state: row.state,
  };
}

function normalizeChannelName(peerName: unknown): string {
  if (typeof peerName !== "string") {
    throw new ApiError("invalid_input", "Peer community name is invalid.");
  }
  const trimmed = peerName.trim();
  if (!trimmed || trimmed.length > 80) {
    throw new ApiError("invalid_input", "Peer community name is invalid.");
  }
  return trimmed;
}

function assertIdempotencyKey(key: unknown): void {
  if (typeof key !== "string" || key.length < 8 || key.length > 200) {
    throw new ApiError("invalid_input", "Idempotency key is invalid.");
  }
}

/**
 * A self-describing, unique group id: a slug of the channel name plus random
 * entropy so two links to the same peer never collide on the relay.
 */
function deriveChannelId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = randomBytes(4).toString("hex");
  return slug ? `${slug}-${suffix}` : `link-${suffix}`;
}
