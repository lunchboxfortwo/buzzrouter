import { randomUUID } from "node:crypto";

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

// A real owner from the relay-signed community roster is promoted; the bot then
// steps itself down to a plain member so it never lingers as channel owner.
const REQUESTER_ROLE = "owner";
const BOT_ROLE = "member";

const CREATE_CONFIRM_TIMEOUT_MS = 3_000;

export interface CreateDedicatedChannelInput {
  communityId: string;
  /** Internal owner-session principal used only to authorize this community. */
  ownerPubkey: string;
  /** The explicit name the owner entered in the channel combobox. */
  channelName: string;
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
 * Create a NIP-29 channel for the open hub and hand its ownership to the
 * relay owner, so they can bind a channel without first leaving BuzzRouter.
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
  const channelName = normalizeChannelName(input.channelName);
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

  const existingHandoff = await findHandoffByKey(
    pool,
    connection.id,
    input.idempotencyKey,
  );
  if (existingHandoff?.state === "completed") {
    return {
      channelId: existingHandoff.channelId,
      channelName: existingHandoff.channelName,
    };
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
    const handoff =
      existingHandoff ??
      (await reserveHandoff(pool, {
        channelName,
        connection,
        idempotencyKey: input.idempotencyKey,
        requesterPubkey: await resolveChannelOwner(
          relay,
          connection.bridgePubkey,
        ),
      }));
    await runHandoff(pool, relay, privateKey, connection.bridgePubkey, handoff);
    return { channelId: handoff.channelId, channelName: handoff.channelName };
  } finally {
    relay?.close();
    privateKey.fill(0);
  }
}

async function resolveChannelOwner(
  relay: RelayConnection,
  bridgePubkey: string,
): Promise<string> {
  const roster = await relay.readRosterRoles();
  if (!roster) {
    throw new ApiError(
      "channel_owner_unavailable",
      "The community owner roster could not be verified.",
      502,
    );
  }
  const privileged = [...roster]
    .filter(
      ([pubkey, role]) =>
        pubkey !== bridgePubkey && (role === "owner" || role === "admin"),
    )
    .sort(([firstKey, firstRole], [secondKey, secondRole]) => {
      if (firstRole !== secondRole) return firstRole === "owner" ? -1 : 1;
      return firstKey.localeCompare(secondKey);
    });
  const owner = privileged[0]?.[0];
  if (!owner) {
    throw new ApiError(
      "channel_owner_unavailable",
      "The relay did not identify an owner or admin for the new channel.",
      409,
    );
  }
  return owner;
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

/**
 * Buzz reads the requested role from a dedicated `role` tag, NOT from the
 * third element of the `p` tag that NIP-29 puts it in: `validate_admin_event`
 * and `handle_put_user` both call `extract_tag_value(event, "role")`, and an
 * absent `role` tag means "no role change", which silently lands a brand new
 * member at `member`. Emitting both keeps the NIP-29 shape while giving Buzz
 * the tag it actually reads — without it the promote would appear to succeed
 * and still leave the channel with no owner once the bridge stepped down.
 */
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
      ["role", role],
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
      ON CONFLICT (connection_id, idempotency_key)
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
      deriveChannelId(),
      input.channelName,
      input.idempotencyKey,
    ],
  );
  return mapHandoff(result.rows[0]);
}

async function findHandoffByKey(
  pool: Pool,
  connectionId: string,
  idempotencyKey: string,
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
      WHERE connection_id = $1 AND idempotency_key = $2
    `,
    [connectionId, idempotencyKey],
  );
  return result.rows[0] ? mapHandoff(result.rows[0]) : null;
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

function normalizeChannelName(channelName: unknown): string {
  if (typeof channelName !== "string") {
    throw new ApiError("invalid_input", "Channel name is invalid.");
  }
  const trimmed = channelName.trim();
  if (!trimmed || trimmed.length > 80) {
    throw new ApiError("invalid_input", "Channel name is invalid.");
  }
  return trimmed;
}

function assertIdempotencyKey(key: unknown): void {
  if (typeof key !== "string" || key.length < 8 || key.length > 200) {
    throw new ApiError("invalid_input", "Idempotency key is invalid.");
  }
}

/**
 * The channel's group id, which MUST be a UUID.
 *
 * Buzz parses the `h` tag with `val.parse::<Uuid>()` and silently drops
 * anything else. On kind 9007 the `h` tag is optional, so a non-UUID id is
 * accepted and the relay mints its own `gen_random_uuid()` instead — the
 * channel is created under an id we never learn. Every later kind 9000 then
 * carries an `h` the relay cannot resolve, and because 9000 requires channel
 * scope it is refused with "invalid: channel-scoped events must include an h
 * tag". That is what stranded three handoffs at `created`. A UUID here is
 * honoured verbatim (`create_channel_with_id`), so the promote/demote steps
 * address the channel that was actually created.
 *
 * The human-readable part of the channel lives in its name, which the relay
 * stores separately; the id is opaque on both sides.
 */
function deriveChannelId(): string {
  return randomUUID();
}
