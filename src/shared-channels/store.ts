import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import type { PgBoss } from "pg-boss";
import type { Pool, PoolClient } from "pg";

import { ApiError } from "../http/api-error";
import { BRIDGE_DELIVERY_QUEUE } from "../jobs/queues";

const VERIFIED_CLAIM_STATES = ["admin_verified", "provider_verified"];
const CONNECTOR_KEY_BYTES = 32;
const WRAPPING_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

export interface EncryptedConnectorKey {
  authTag: Buffer;
  ciphertext: Buffer;
  nonce: Buffer;
}

export interface CommunityConnectionRecord {
  bridgePubkey: string;
  communityId: string;
  health:
    | "pending"
    | "healthy"
    | "degraded"
    | "unauthorized"
    | "unreachable"
    | "credential_error";
  id: string;
  relayUrl: string;
  state: "installing" | "active" | "revoked" | "failed";
  wrappingKeyVersion: number;
}

export interface SharedChannelRecord {
  createdAt: string;
  id: string;
  proposedByCommunityId: string;
  proposedName: string;
  purpose: string;
  state: "proposed" | "active" | "rejected" | "disconnected";
}

export interface SharedChannelEndpointRecord {
  communityId: string;
  connectionId: string | null;
  id: string;
  localChannelId: string | null;
  localChannelName: string | null;
  role: "source" | "destination";
  sharedChannelId: string;
  state: "pending" | "active" | "paused" | "disconnected";
}

export interface BeginCommunityConnectionInstallInput {
  bridgePubkey: string;
  communityId: string;
  ownerPubkey: string;
  privateKey: Uint8Array;
  tokenHash: string;
  wrappingKey: Uint8Array;
  wrappingKeyVersion: number;
}

export interface BeginCommunityConnectionInstallResult {
  connection: CommunityConnectionRecord;
  expiresAt: string;
  tokenId: string;
}

export interface CreateSharedChannelInput {
  destinationCommunityId: string;
  expiresAt?: Date;
  idempotencyKey: string;
  ownerPubkey: string;
  proposedName: string;
  purpose: string;
  sourceChannelId: string;
  sourceChannelName: string;
  sourceCommunityId: string;
}

export interface AcceptSharedChannelInput {
  communityId: string;
  idempotencyKey: string;
  localChannelId: string;
  localChannelName: string;
  ownerPubkey: string;
  sharedChannelId: string;
}

export interface ChangeEndpointStateInput {
  communityId: string;
  idempotencyKey: string;
  ownerPubkey: string;
  sharedChannelId: string;
}

export interface IngestBridgeMessageInput {
  body: string;
  bodySha256: string;
  messageId: string;
  parentBridgeMessageId?: string;
  sharedChannelId: string;
  signedEvent: unknown;
  sourceActorPubkey: string;
  sourceEndpointId: string;
  sourceEventId: string;
  sourceParentEventId?: string;
}

export interface IngestBridgeMessageResult {
  created: boolean;
  deliveryId: string;
  messageId: string;
}

interface SharedChannelRow {
  created_at: Date;
  expires_at: Date | null;
  id: string;
  proposed_by_community_id: string;
  proposed_name: string;
  purpose: string;
  state: SharedChannelRecord["state"];
}

interface SharedChannelEndpointRow {
  community_id: string;
  connection_id: string | null;
  id: string;
  local_channel_id: string | null;
  local_channel_name_snapshot: string | null;
  role: SharedChannelEndpointRecord["role"];
  shared_channel_id: string;
  state: SharedChannelEndpointRecord["state"];
}

interface CommunityConnectionRow {
  bridge_pubkey: string;
  community_id: string;
  health: CommunityConnectionRecord["health"];
  id: string;
  relay_url_snapshot: string;
  state: CommunityConnectionRecord["state"];
  wrapping_key_version: number;
}

export function encryptConnectorPrivateKey(
  privateKey: Uint8Array,
  wrappingKey: Uint8Array,
  communityId: string,
): EncryptedConnectorKey {
  assertKeyLength(privateKey, CONNECTOR_KEY_BYTES, "Connector private key");
  assertKeyLength(wrappingKey, WRAPPING_KEY_BYTES, "Wrapping key");

  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(wrappingKey),
    nonce,
  );
  cipher.setAAD(connectorKeyAad(communityId));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKey)),
    cipher.final(),
  ]);

  return {
    authTag: cipher.getAuthTag(),
    ciphertext,
    nonce,
  };
}

export function decryptConnectorPrivateKey(
  encrypted: EncryptedConnectorKey,
  wrappingKey: Uint8Array,
  communityId: string,
): Buffer {
  assertKeyLength(wrappingKey, WRAPPING_KEY_BYTES, "Wrapping key");
  if (
    encrypted.nonce.byteLength !== GCM_NONCE_BYTES ||
    encrypted.authTag.byteLength !== GCM_TAG_BYTES
  ) {
    throw new ApiError(
      "connector_key_invalid",
      "Connector key material is invalid.",
      500,
    );
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(wrappingKey),
      encrypted.nonce,
    );
    decipher.setAAD(connectorKeyAad(communityId));
    decipher.setAuthTag(encrypted.authTag);
    const privateKey = Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ]);
    assertKeyLength(
      privateKey,
      CONNECTOR_KEY_BYTES,
      "Connector private key",
    );
    return privateKey;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "connector_key_unavailable",
      "Connector key could not be decrypted.",
      500,
      { cause: error },
    );
  }
}

export async function beginCommunityConnectionInstall(
  pool: Pool,
  input: BeginCommunityConnectionInstallInput,
): Promise<BeginCommunityConnectionInstallResult> {
  assertHex(input.bridgePubkey, 64, "Bridge public key");
  assertHex(input.tokenHash, 64, "Install token hash");
  if (
    !Number.isInteger(input.wrappingKeyVersion) ||
    input.wrappingKeyVersion < 1
  ) {
    throw new ApiError(
      "invalid_input",
      "Wrapping key version is invalid.",
    );
  }

  const encrypted = encryptConnectorPrivateKey(
    input.privateKey,
    input.wrappingKey,
    input.communityId,
  );

  return withTransaction(pool, async (client) => {
    const community = await requireVerifiedOwner(
      client,
      input.communityId,
      input.ownerPubkey,
    );

    await client.query(
      `
        UPDATE connection_install_tokens
        SET state = 'expired',
            updated_at = now()
        WHERE community_id = $1
          AND state = 'pending'
      `,
      [input.communityId],
    );

    const connectionResult = await client.query<CommunityConnectionRow>(
      `
        INSERT INTO community_connections (
          community_id,
          relay_url_snapshot,
          bridge_pubkey,
          encrypted_private_key,
          private_key_nonce,
          private_key_auth_tag,
          wrapping_key_version,
          state,
          health,
          revoked_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'installing', 'pending', NULL, now())
        ON CONFLICT (community_id) DO UPDATE
        SET relay_url_snapshot = EXCLUDED.relay_url_snapshot,
            bridge_pubkey = EXCLUDED.bridge_pubkey,
            encrypted_private_key = EXCLUDED.encrypted_private_key,
            private_key_nonce = EXCLUDED.private_key_nonce,
            private_key_auth_tag = EXCLUDED.private_key_auth_tag,
            wrapping_key_version = EXCLUDED.wrapping_key_version,
            state = 'installing',
            health = 'pending',
            last_health_error = NULL,
            last_health_at = NULL,
            activated_at = NULL,
            revoked_at = NULL,
            updated_at = now()
        WHERE community_connections.state <> 'active'
        RETURNING
          id,
          community_id,
          relay_url_snapshot,
          bridge_pubkey,
          wrapping_key_version,
          state,
          health
      `,
      [
        input.communityId,
        community.relayUrl,
        input.bridgePubkey,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.authTag,
        input.wrappingKeyVersion,
      ],
    );
    const connection = connectionResult.rows[0];
    if (!connection) {
      throw new ApiError(
        "connection_already_active",
        "The community connection is already active.",
        409,
      );
    }

    const tokenResult = await client.query<{
      expires_at: Date;
      id: string;
    }>(
      `
        INSERT INTO connection_install_tokens (
          community_id,
          token_hash,
          owner_pubkey,
          bridge_pubkey,
          expires_at
        )
        VALUES ($1, $2, $3, $4, now() + interval '15 minutes')
        RETURNING id, expires_at
      `,
      [
        input.communityId,
        input.tokenHash,
        input.ownerPubkey,
        input.bridgePubkey,
      ],
    );

    return {
      connection: mapConnection(connection),
      expiresAt: tokenResult.rows[0].expires_at.toISOString(),
      tokenId: tokenResult.rows[0].id,
    };
  });
}

export async function activateCommunityConnection(
  pool: Pool,
  tokenHash: string,
  activationReceipt: Record<string, unknown>,
): Promise<CommunityConnectionRecord> {
  assertHex(tokenHash, 64, "Install token hash");

  return withTransaction(pool, async (client) => {
    const tokenResult = await client.query<{
      bridge_pubkey: string;
      community_id: string;
      id: string;
    }>(
      `
        UPDATE connection_install_tokens
        SET state = 'consumed',
            attempts = attempts + 1,
            consumed_at = now(),
            activation_receipt = $2,
            updated_at = now()
        WHERE token_hash = $1
          AND state = 'pending'
          AND expires_at > now()
          AND attempts < 10
        RETURNING id, community_id, bridge_pubkey
      `,
      [tokenHash, activationReceipt],
    );
    const token = tokenResult.rows[0];
    if (!token) {
      throw new ApiError(
        "install_token_unavailable",
        "The install token is expired or already used.",
        409,
      );
    }

    const connectionResult = await client.query<CommunityConnectionRow>(
      `
        UPDATE community_connections
        SET state = 'active',
            health = 'pending',
            activated_at = now(),
            updated_at = now()
        WHERE community_id = $1
          AND bridge_pubkey = $2
          AND state = 'installing'
        RETURNING
          id,
          community_id,
          relay_url_snapshot,
          bridge_pubkey,
          wrapping_key_version,
          state,
          health
      `,
      [token.community_id, token.bridge_pubkey],
    );
    const connection = connectionResult.rows[0];
    if (!connection) {
      throw new ApiError(
        "connection_activation_failed",
        "The community connection could not be activated.",
        409,
      );
    }

    return mapConnection(connection);
  });
}

export async function createSharedChannel(
  pool: Pool,
  input: CreateSharedChannelInput,
): Promise<SharedChannelRecord> {
  if (input.sourceCommunityId === input.destinationCommunityId) {
    throw new ApiError(
      "invalid_input",
      "A shared channel requires two communities.",
    );
  }
  assertText(input.proposedName, 1, 80, "Proposed channel name");
  assertText(input.purpose, 1, 500, "Purpose");
  assertText(input.sourceChannelId, 1, 200, "Source channel");
  assertText(input.sourceChannelName, 1, 80, "Source channel name");
  assertIdempotencyKey(input.idempotencyKey);

  return withTransaction(pool, async (client) => {
    await lockIdempotencyKey(
      client,
      input.ownerPubkey,
      input.idempotencyKey,
    );
    const prior = await getIdempotentSharedChannel(
      client,
      input.ownerPubkey,
      input.idempotencyKey,
      "shared_channel.proposed",
    );
    if (prior) return prior;

    await requireVerifiedOwner(
      client,
      input.sourceCommunityId,
      input.ownerPubkey,
    );
    await requireVerifiedCommunity(
      client,
      input.destinationCommunityId,
    );
    const sourceConnection = await requireActiveConnection(
      client,
      input.sourceCommunityId,
    );

    const channelResult = await client.query<SharedChannelRow>(
      `
        INSERT INTO shared_channels (
          proposed_by_community_id,
          proposed_name,
          purpose,
          created_by,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          proposed_by_community_id,
          proposed_name,
          purpose,
          state,
          created_at,
          expires_at
      `,
      [
        input.sourceCommunityId,
        input.proposedName,
        input.purpose,
        input.ownerPubkey,
        input.expiresAt ?? null,
      ],
    );
    const channel = channelResult.rows[0];

    await client.query(
      `
        INSERT INTO shared_channel_endpoints (
          shared_channel_id,
          community_id,
          connection_id,
          role,
          state,
          relay_url_snapshot,
          local_channel_id,
          local_channel_name_snapshot,
          accepted_by,
          accepted_at
        )
        VALUES
          ($1, $2, $3, 'source', 'active', $4, $5, $6, $7, now()),
          ($1, $8, NULL, 'destination', 'pending', NULL, NULL, NULL, NULL, NULL)
      `,
      [
        channel.id,
        input.sourceCommunityId,
        sourceConnection.id,
        sourceConnection.relayUrl,
        input.sourceChannelId,
        input.sourceChannelName,
        input.ownerPubkey,
        input.destinationCommunityId,
      ],
    );
    await insertAuditEvent(client, {
      action: "shared_channel.proposed",
      actorPubkey: input.ownerPubkey,
      communityId: input.sourceCommunityId,
      idempotencyKey: input.idempotencyKey,
      nextState: "proposed",
      sharedChannelId: channel.id,
      targetId: channel.id,
    });

    return mapSharedChannel(channel);
  });
}

export async function acceptSharedChannel(
  pool: Pool,
  input: AcceptSharedChannelInput,
): Promise<SharedChannelRecord> {
  assertText(input.localChannelId, 1, 200, "Local channel");
  assertText(input.localChannelName, 1, 80, "Local channel name");

  return mutateSharedChannel(
    pool,
    {
      action: "shared_channel.accepted",
      ...input,
    },
    async (client, channel) => {
      if (channel.state !== "proposed") {
        throw invalidChannelState();
      }
      if (
        channel.expires_at &&
        channel.expires_at.getTime() <= Date.now()
      ) {
        throw new ApiError(
          "invitation_expired",
          "The shared-channel invitation has expired.",
          409,
        );
      }
      const connection = await requireActiveConnection(
        client,
        input.communityId,
      );
      const endpointResult = await client.query<{ id: string }>(
        `
          UPDATE shared_channel_endpoints
          SET connection_id = $3,
              state = 'active',
              relay_url_snapshot = $4,
              local_channel_id = $5,
              local_channel_name_snapshot = $6,
              accepted_by = $7,
              accepted_at = now(),
              updated_at = now()
          WHERE shared_channel_id = $1
            AND community_id = $2
            AND role = 'destination'
            AND state = 'pending'
          RETURNING id
        `,
        [
          input.sharedChannelId,
          input.communityId,
          connection.id,
          connection.relayUrl,
          input.localChannelId,
          input.localChannelName,
          input.ownerPubkey,
        ],
      );
      if (!endpointResult.rows[0]) {
        throw new ApiError(
          "invitation_not_found",
          "The invitation is unavailable.",
          404,
        );
      }

      return updateChannelState(
        client,
        input.sharedChannelId,
        "active",
      );
    },
  );
}

export async function rejectSharedChannel(
  pool: Pool,
  input: ChangeEndpointStateInput,
): Promise<SharedChannelRecord> {
  return mutateSharedChannel(
    pool,
    {
      action: "shared_channel.rejected",
      ...input,
    },
    async (client, channel) => {
      if (channel.state !== "proposed") {
        throw invalidChannelState();
      }
      const destination = await client.query<{ id: string }>(
        `
          SELECT id
          FROM shared_channel_endpoints
          WHERE shared_channel_id = $1
            AND community_id = $2
            AND role = 'destination'
          FOR UPDATE
        `,
        [input.sharedChannelId, input.communityId],
      );
      if (!destination.rows[0]) {
        throw new ApiError(
          "invitation_not_found",
          "The invitation is unavailable.",
          404,
        );
      }

      await client.query(
        `
          UPDATE shared_channel_endpoints
          SET state = 'disconnected',
              updated_at = now()
          WHERE shared_channel_id = $1
        `,
        [input.sharedChannelId],
      );
      const result = await client.query<SharedChannelRow>(
        `
          UPDATE shared_channels
          SET state = 'rejected',
              rejected_by = $2,
              rejected_at = now(),
              updated_at = now()
          WHERE id = $1
          RETURNING
            id,
            proposed_by_community_id,
            proposed_name,
            purpose,
            state,
            created_at,
            expires_at
        `,
        [input.sharedChannelId, input.ownerPubkey],
      );
      return result.rows[0];
    },
  );
}

export async function pauseSharedChannelEndpoint(
  pool: Pool,
  input: ChangeEndpointStateInput,
): Promise<SharedChannelRecord> {
  return changeEndpointState(
    pool,
    input,
    "active",
    "paused",
    "shared_channel.paused",
  );
}

export async function resumeSharedChannelEndpoint(
  pool: Pool,
  input: ChangeEndpointStateInput,
): Promise<SharedChannelRecord> {
  return changeEndpointState(
    pool,
    input,
    "paused",
    "active",
    "shared_channel.resumed",
  );
}

export async function disconnectSharedChannel(
  pool: Pool,
  input: ChangeEndpointStateInput,
): Promise<SharedChannelRecord> {
  return mutateSharedChannel(
    pool,
    {
      action: "shared_channel.disconnected",
      ...input,
    },
    async (client, channel) => {
      if (channel.state !== "active") {
        throw invalidChannelState();
      }

      await client.query(
        `
          UPDATE shared_channel_endpoints
          SET state = 'disconnected',
              updated_at = now()
          WHERE shared_channel_id = $1
        `,
        [input.sharedChannelId],
      );
      await client.query(
        `
          UPDATE bridge_deliveries AS deliveries
          SET state = 'cancelled',
              terminal_error_code = 'route_disconnected',
              updated_at = now()
          FROM bridge_messages AS messages
          WHERE deliveries.bridge_message_id = messages.id
            AND messages.shared_channel_id = $1
            AND deliveries.state IN ('queued', 'delivering', 'retry')
        `,
        [input.sharedChannelId],
      );
      const result = await client.query<SharedChannelRow>(
        `
          UPDATE shared_channels
          SET state = 'disconnected',
              disconnected_by = $2,
              disconnected_at = now(),
              updated_at = now()
          WHERE id = $1
          RETURNING
            id,
            proposed_by_community_id,
            proposed_name,
            purpose,
            state,
            created_at,
            expires_at
        `,
        [input.sharedChannelId, input.ownerPubkey],
      );
      return result.rows[0];
    },
  );
}

export async function ingestBridgeMessage(
  pool: Pool,
  boss: PgBoss,
  input: IngestBridgeMessageInput,
): Promise<IngestBridgeMessageResult> {
  assertHex(input.sourceEventId, 64, "Source event ID");
  assertHex(input.sourceActorPubkey, 64, "Source actor public key");
  assertHex(input.bodySha256, 64, "Body hash");
  assertText(input.body, 1, 16 * 1_024, "Message body", true);

  return withTransaction(pool, async (client) => {
    const endpointResult =
      await client.query<SharedChannelEndpointRow>(
        `
          SELECT
            endpoints.id,
            endpoints.shared_channel_id,
            endpoints.community_id,
            endpoints.connection_id,
            endpoints.role,
            endpoints.state,
            endpoints.local_channel_id,
            endpoints.local_channel_name_snapshot
          FROM shared_channel_endpoints AS endpoints
          JOIN shared_channels AS channels
            ON channels.id = endpoints.shared_channel_id
          WHERE endpoints.id = $1
            AND endpoints.shared_channel_id = $2
            AND endpoints.state = 'active'
            AND channels.state = 'active'
          FOR SHARE OF endpoints, channels
        `,
        [input.sourceEndpointId, input.sharedChannelId],
      );
    if (!endpointResult.rows[0]) {
      throw new ApiError(
        "route_inactive",
        "The shared channel is not active.",
        409,
      );
    }

    const destinationResult =
      await client.query<SharedChannelEndpointRow>(
        `
          SELECT
            id,
            shared_channel_id,
            community_id,
            connection_id,
            role,
            state,
            local_channel_id,
            local_channel_name_snapshot
          FROM shared_channel_endpoints
          WHERE shared_channel_id = $1
            AND id <> $2
            AND state = 'active'
          FOR SHARE
        `,
        [input.sharedChannelId, input.sourceEndpointId],
      );
    const destination = destinationResult.rows[0];
    if (!destination) {
      throw new ApiError(
        "route_inactive",
        "The destination endpoint is not active.",
        409,
      );
    }

    const messageResult = await client.query<{ id: string }>(
      `
        INSERT INTO bridge_messages (
          id,
          shared_channel_id,
          source_endpoint_id,
          source_event_id,
          source_actor_pubkey,
          source_signed_event,
          source_parent_event_id,
          parent_bridge_message_id,
          body,
          body_sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (
          shared_channel_id,
          source_endpoint_id,
          source_event_id
        ) DO NOTHING
        RETURNING id
      `,
      [
        input.messageId,
        input.sharedChannelId,
        input.sourceEndpointId,
        input.sourceEventId,
        input.sourceActorPubkey,
        input.signedEvent,
        input.sourceParentEventId ?? null,
        input.parentBridgeMessageId ?? null,
        input.body,
        input.bodySha256,
      ],
    );
    if (!messageResult.rows[0]) {
      const existing = await client.query<{
        delivery_id: string;
        message_id: string;
      }>(
        `
          SELECT
            messages.id AS message_id,
            deliveries.id AS delivery_id
          FROM bridge_messages AS messages
          JOIN bridge_deliveries AS deliveries
            ON deliveries.bridge_message_id = messages.id
          WHERE messages.shared_channel_id = $1
            AND messages.source_endpoint_id = $2
            AND messages.source_event_id = $3
        `,
        [
          input.sharedChannelId,
          input.sourceEndpointId,
          input.sourceEventId,
        ],
      );
      const row = existing.rows[0];
      if (!row) {
        throw new ApiError(
          "message_ingest_failed",
          "The existing message delivery is unavailable.",
          500,
        );
      }
      return {
        created: false,
        deliveryId: row.delivery_id,
        messageId: row.message_id,
      };
    }

    const deliveryResult = await client.query<{ id: string }>(
      `
        INSERT INTO bridge_deliveries (
          bridge_message_id,
          destination_endpoint_id
        )
        VALUES ($1, $2)
        RETURNING id
      `,
      [input.messageId, destination.id],
    );
    const deliveryId = deliveryResult.rows[0].id;
    const transactionDb = {
      executeSql: async (text: string, values?: unknown[]) => {
        const result = await client.query(text, values);
        return { rows: result.rows };
      },
    };
    const jobId = await boss.send(
      BRIDGE_DELIVERY_QUEUE,
      { deliveryId },
      {
        db: transactionDb,
        id: input.messageId,
      },
    );
    if (!jobId) {
      throw new ApiError(
        "message_enqueue_failed",
        "The message could not be queued.",
        500,
      );
    }

    return {
      created: true,
      deliveryId,
      messageId: input.messageId,
    };
  });
}

export async function listSharedChannelEndpoints(
  pool: Pool,
  sharedChannelId: string,
): Promise<SharedChannelEndpointRecord[]> {
  const result = await pool.query<SharedChannelEndpointRow>(
    `
      SELECT
        id,
        shared_channel_id,
        community_id,
        connection_id,
        role,
        state,
        local_channel_id,
        local_channel_name_snapshot
      FROM shared_channel_endpoints
      WHERE shared_channel_id = $1
      ORDER BY role DESC
    `,
    [sharedChannelId],
  );
  return result.rows.map(mapEndpoint);
}

async function changeEndpointState(
  pool: Pool,
  input: ChangeEndpointStateInput,
  expectedState: SharedChannelEndpointRecord["state"],
  nextState: SharedChannelEndpointRecord["state"],
  action: string,
): Promise<SharedChannelRecord> {
  return mutateSharedChannel(
    pool,
    { action, ...input },
    async (client, channel) => {
      if (channel.state !== "active") {
        throw invalidChannelState();
      }
      const result = await client.query<{ id: string }>(
        `
          UPDATE shared_channel_endpoints
          SET state = $4,
              updated_at = now()
          WHERE shared_channel_id = $1
            AND community_id = $2
            AND state = $3
          RETURNING id
        `,
        [
          input.sharedChannelId,
          input.communityId,
          expectedState,
          nextState,
        ],
      );
      if (!result.rows[0]) {
        throw invalidChannelState();
      }
      return channel;
    },
    {
      nextState,
      previousState: expectedState,
    },
  );
}

async function mutateSharedChannel(
  pool: Pool,
  input: ChangeEndpointStateInput & { action: string },
  mutation: (
    client: PoolClient,
    channel: SharedChannelRow,
  ) => Promise<SharedChannelRow>,
  auditState?: {
    nextState: string;
    previousState: string;
  },
): Promise<SharedChannelRecord> {
  assertIdempotencyKey(input.idempotencyKey);

  return withTransaction(pool, async (client) => {
    await lockIdempotencyKey(
      client,
      input.ownerPubkey,
      input.idempotencyKey,
    );
    const prior = await getIdempotentSharedChannel(
      client,
      input.ownerPubkey,
      input.idempotencyKey,
      input.action,
    );
    if (prior) return prior;

    await requireVerifiedOwner(
      client,
      input.communityId,
      input.ownerPubkey,
    );
    const channel = await requireOwnedEndpointChannel(
      client,
      input.sharedChannelId,
      input.communityId,
    );
    const updated = await mutation(client, channel);
    await insertAuditEvent(client, {
      action: input.action,
      actorPubkey: input.ownerPubkey,
      communityId: input.communityId,
      idempotencyKey: input.idempotencyKey,
      nextState: auditState?.nextState ?? updated.state,
      previousState: auditState?.previousState ?? channel.state,
      sharedChannelId: input.sharedChannelId,
      targetId: input.sharedChannelId,
    });
    return mapSharedChannel(updated);
  });
}

async function requireOwnedEndpointChannel(
  client: PoolClient,
  sharedChannelId: string,
  communityId: string,
): Promise<SharedChannelRow> {
  const result = await client.query<SharedChannelRow>(
    `
      SELECT
        channels.id,
        channels.proposed_by_community_id,
        channels.proposed_name,
        channels.purpose,
        channels.state,
        channels.created_at,
        channels.expires_at
      FROM shared_channels AS channels
      JOIN shared_channel_endpoints AS endpoints
        ON endpoints.shared_channel_id = channels.id
      WHERE channels.id = $1
        AND endpoints.community_id = $2
      FOR UPDATE OF channels
    `,
    [sharedChannelId, communityId],
  );
  const channel = result.rows[0];
  if (!channel) {
    throw new ApiError(
      "shared_channel_not_found",
      "The shared channel is unavailable.",
      404,
    );
  }
  return channel;
}

async function updateChannelState(
  client: PoolClient,
  sharedChannelId: string,
  state: SharedChannelRecord["state"],
): Promise<SharedChannelRow> {
  const result = await client.query<SharedChannelRow>(
    `
      UPDATE shared_channels
      SET state = $2,
          updated_at = now()
      WHERE id = $1
      RETURNING
        id,
        proposed_by_community_id,
        proposed_name,
        purpose,
        state,
        created_at,
        expires_at
    `,
    [sharedChannelId, state],
  );
  return result.rows[0];
}

async function requireVerifiedOwner(
  client: PoolClient,
  communityId: string,
  ownerPubkey: string,
): Promise<{ relayUrl: string }> {
  assertHex(ownerPubkey, 64, "Owner public key");
  const result = await client.query<{ canonical_relay_url: string }>(
    `
      SELECT candidates.canonical_relay_url
      FROM communities
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      WHERE communities.id = $1
        AND communities.owner_pubkey = $2
        AND communities.claim_state = ANY($3::text[])
        AND candidates.state = 'verified_buzz'
      FOR SHARE OF communities
    `,
    [communityId, ownerPubkey, VERIFIED_CLAIM_STATES],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "community_owner_required",
      "Verified community ownership is required.",
      403,
    );
  }
  return { relayUrl: row.canonical_relay_url };
}

async function requireVerifiedCommunity(
  client: PoolClient,
  communityId: string,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `
      SELECT communities.id
      FROM communities
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      WHERE communities.id = $1
        AND communities.owner_pubkey IS NOT NULL
        AND communities.claim_state = ANY($2::text[])
        AND candidates.state = 'verified_buzz'
      FOR SHARE OF communities
    `,
    [communityId, VERIFIED_CLAIM_STATES],
  );
  if (!result.rows[0]) {
    throw new ApiError(
      "destination_not_verified",
      "The destination community is not verified.",
      409,
    );
  }
}

async function requireActiveConnection(
  client: PoolClient,
  communityId: string,
): Promise<{ id: string; relayUrl: string }> {
  const result = await client.query<{
    id: string;
    relay_url_snapshot: string;
  }>(
    `
      SELECT id, relay_url_snapshot
      FROM community_connections
      WHERE community_id = $1
        AND state = 'active'
      FOR SHARE
    `,
    [communityId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "connection_required",
      "The community connector must be active.",
      409,
    );
  }
  return { id: row.id, relayUrl: row.relay_url_snapshot };
}

async function lockIdempotencyKey(
  client: PoolClient,
  actorPubkey: string,
  idempotencyKey: string,
): Promise<void> {
  await client.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtextextended($1 || ':' || $2, 0)
      )
    `,
    [actorPubkey, idempotencyKey],
  );
}

async function getIdempotentSharedChannel(
  client: PoolClient,
  actorPubkey: string,
  idempotencyKey: string,
  expectedAction: string,
): Promise<SharedChannelRecord | null> {
  const result = await client.query<
    SharedChannelRow & { action: string }
  >(
    `
      SELECT
        audit.action,
        channels.id,
        channels.proposed_by_community_id,
        channels.proposed_name,
        channels.purpose,
        channels.state,
        channels.created_at,
        channels.expires_at
      FROM shared_channel_audit_events AS audit
      JOIN shared_channels AS channels
        ON channels.id = audit.target_id
      WHERE audit.actor_pubkey = $1
        AND audit.idempotency_key = $2
    `,
    [actorPubkey, idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.action !== expectedAction) {
    throw new ApiError(
      "idempotency_conflict",
      "The idempotency key was used for another action.",
      409,
    );
  }
  return mapSharedChannel(row);
}

async function insertAuditEvent(
  client: PoolClient,
  input: {
    action: string;
    actorPubkey: string;
    communityId: string;
    idempotencyKey: string;
    nextState?: string;
    previousState?: string;
    sharedChannelId: string;
    targetId: string;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO shared_channel_audit_events (
        shared_channel_id,
        community_id,
        actor_pubkey,
        action,
        target_id,
        previous_state,
        next_state,
        idempotency_key
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      input.sharedChannelId,
      input.communityId,
      input.actorPubkey,
      input.action,
      input.targetId,
      input.previousState ?? null,
      input.nextState ?? null,
      input.idempotencyKey,
    ],
  );
}

async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapConnection(
  row: CommunityConnectionRow,
): CommunityConnectionRecord {
  return {
    bridgePubkey: row.bridge_pubkey,
    communityId: row.community_id,
    health: row.health,
    id: row.id,
    relayUrl: row.relay_url_snapshot,
    state: row.state,
    wrappingKeyVersion: row.wrapping_key_version,
  };
}

function mapSharedChannel(row: SharedChannelRow): SharedChannelRecord {
  return {
    createdAt: row.created_at.toISOString(),
    id: row.id,
    proposedByCommunityId: row.proposed_by_community_id,
    proposedName: row.proposed_name,
    purpose: row.purpose,
    state: row.state,
  };
}

function mapEndpoint(
  row: SharedChannelEndpointRow,
): SharedChannelEndpointRecord {
  return {
    communityId: row.community_id,
    connectionId: row.connection_id,
    id: row.id,
    localChannelId: row.local_channel_id,
    localChannelName: row.local_channel_name_snapshot,
    role: row.role,
    sharedChannelId: row.shared_channel_id,
    state: row.state,
  };
}

function connectorKeyAad(communityId: string): Buffer {
  return Buffer.from(
    `buzzrouter:community-connector:${communityId}`,
    "utf8",
  );
}

function assertKeyLength(
  key: Uint8Array,
  expectedBytes: number,
  label: string,
): void {
  if (key.byteLength !== expectedBytes) {
    throw new ApiError(
      "invalid_input",
      `${label} must be ${expectedBytes} bytes.`,
    );
  }
}

function assertHex(
  value: string,
  length: number,
  label: string,
): void {
  if (
    typeof value !== "string" ||
    value.length !== length ||
    !/^[a-f0-9]+$/.test(value)
  ) {
    throw new ApiError("invalid_input", `${label} is invalid.`);
  }
}

function assertIdempotencyKey(value: string): void {
  assertText(value, 8, 200, "Idempotency key");
}

function assertText(
  value: string,
  minimum: number,
  maximum: number,
  label: string,
  measureBytes = false,
): void {
  if (typeof value !== "string") {
    throw new ApiError("invalid_input", `${label} is invalid.`);
  }
  const length = measureBytes
    ? Buffer.byteLength(value, "utf8")
    : value.length;
  if (
    length < minimum ||
    length > maximum
  ) {
    throw new ApiError("invalid_input", `${label} is invalid.`);
  }
}

function invalidChannelState(): ApiError {
  return new ApiError(
    "shared_channel_state_conflict",
    "The shared channel state has changed.",
    409,
  );
}
