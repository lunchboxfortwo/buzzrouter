import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import type { PgBoss } from "pg-boss";
import type { Event } from "nostr-tools/core";
import { getPublicKey } from "nostr-tools/pure";
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

export interface SharedChannelCommunitySummary {
  connectionHealth: CommunityConnectionRecord["health"] | null;
  connectionState: CommunityConnectionRecord["state"] | null;
  displayName: string;
  featured: boolean;
  id: string;
  relayUrl: string;
  slug: string | null;
}

/**
 * BuzzRouter's own community. It is offered as the canonical first shared
 * channel so an owner can exercise the whole flow — and reach the team —
 * without needing to find a willing peer first.
 */
export function homeCommunityHost(): string {
  return (
    process.env.BUZZROUTER_HOME_COMMUNITY_HOST ?? "relay.buzzrouter.com"
  );
}

export interface SharedChannelAdminRecord extends SharedChannelRecord {
  ownCommunityId: string;
  ownEndpointId: string;
  ownEndpointState: SharedChannelEndpointRecord["state"];
  ownLocalChannelId: string | null;
  ownLocalChannelName: string | null;
  peerCommunityId: string;
  peerDisplayName: string;
  peerEndpointState: SharedChannelEndpointRecord["state"];
  peerSlug: string | null;
}

export interface SharedChannelAdminWorkspace {
  channels: SharedChannelAdminRecord[];
  communities: SharedChannelCommunitySummary[];
  destinations: SharedChannelCommunitySummary[];
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

export interface CommunityConnectionInstallContext
  extends CommunityConnectionRecord,
    EncryptedConnectorKey {
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
  sourceCreatedAt: number;
  sourceEndpointId: string;
  sourceEventId: string;
  sourceParentEventId?: string;
}

export interface IngestBridgeMessageResult {
  created: boolean;
  deliveryId: string;
  messageId: string;
}

export interface ConnectorRouteConfig {
  lastEventCreatedAt: number;
  localChannelId: string;
  sharedChannelId: string;
  sourceEndpointId: string;
}

export interface ActiveConnectorConfig
  extends CommunityConnectionRecord,
    EncryptedConnectorKey {
  routes: ConnectorRouteConfig[];
}

export interface BridgeDeliveryContext {
  attempts: number;
  body: string;
  deliveryId: string;
  destinationChannelId: string;
  destinationConnectionId: string;
  destinationEndpointId: string;
  destinationEvent: Event | null;
  localParentEventId: string | null;
  messageId: string;
  routeActive: boolean;
  sharedChannelId: string;
  sourceActorPubkey: string;
  sourceCommunityId: string;
  sourceCommunityName: string;
  sourceEventId: string;
  sourceParentEventId: string | null;
  state:
    | "queued"
    | "delivering"
    | "retry"
    | "delivered_to_relay"
    | "failed"
    | "cancelled";
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
  if (getPublicKey(input.privateKey) !== input.bridgePubkey) {
    throw new ApiError(
      "connector_key_mismatch",
      "The connector key pair is invalid.",
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

export async function getCommunityConnectionInstallContext(
  pool: Pool,
  tokenHash: string,
): Promise<CommunityConnectionInstallContext> {
  assertHex(tokenHash, 64, "Install token hash");
  const result = await pool.query<
    CommunityConnectionRow & {
      encrypted_private_key: Buffer;
      expires_at: Date;
      private_key_auth_tag: Buffer;
      private_key_nonce: Buffer;
      token_id: string;
    }
  >(
    `
      SELECT
        connections.id,
        connections.community_id,
        connections.relay_url_snapshot,
        connections.bridge_pubkey,
        connections.encrypted_private_key,
        connections.private_key_nonce,
        connections.private_key_auth_tag,
        connections.wrapping_key_version,
        connections.state,
        connections.health,
        tokens.id AS token_id,
        tokens.expires_at
      FROM connection_install_tokens AS tokens
      JOIN community_connections AS connections
        ON connections.community_id = tokens.community_id
        AND connections.bridge_pubkey = tokens.bridge_pubkey
      WHERE tokens.token_hash = $1
        AND tokens.state = 'pending'
        AND tokens.expires_at > now()
        AND tokens.attempts < 10
        AND connections.state = 'installing'
    `,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "install_token_unavailable",
      "The install token is expired or already used.",
      409,
    );
  }
  return {
    ...mapConnection(row),
    authTag: row.private_key_auth_tag,
    ciphertext: row.encrypted_private_key,
    expiresAt: row.expires_at.toISOString(),
    nonce: row.private_key_nonce,
    tokenId: row.token_id,
  };
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
          last_event_created_at,
          accepted_by,
          accepted_at
        )
        VALUES
          (
            $1,
            $2,
            $3,
            'source',
            'active',
            $4,
            $5,
            $6,
            floor(extract(epoch FROM now()))::bigint,
            $7,
            now()
          ),
          (
            $1,
            $8,
            NULL,
            'destination',
            'pending',
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL
          )
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
              last_event_created_at = floor(extract(epoch FROM now()))::bigint,
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
          source_created_at,
          source_signed_event,
          source_parent_event_id,
          parent_bridge_message_id,
          body,
          body_sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        input.sourceCreatedAt,
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

    await client.query(
      `
        INSERT INTO bridge_event_mappings (
          shared_channel_id,
          endpoint_id,
          bridge_message_id,
          local_event_id,
          local_parent_event_id
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        input.sharedChannelId,
        input.sourceEndpointId,
        input.messageId,
        input.sourceEventId,
        input.sourceParentEventId ?? null,
      ],
    );
    await client.query(
      `
        UPDATE shared_channel_endpoints
        SET last_event_created_at = GREATEST(
              COALESCE(last_event_created_at, 0),
              $2
            ),
            updated_at = now()
        WHERE id = $1
      `,
      [input.sourceEndpointId, input.sourceCreatedAt],
    );

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

export async function getSharedChannelAdminWorkspace(
  pool: Pool,
  ownerPubkey: string,
): Promise<SharedChannelAdminWorkspace> {
  assertHex(ownerPubkey, 64, "Owner public key");

  const communities = await pool.query<{
    connection_health: CommunityConnectionRecord["health"] | null;
    connection_state: CommunityConnectionRecord["state"] | null;
    display_name: string;
    id: string;
    relay_url: string;
    slug: string | null;
  }>(
    `
      SELECT
        communities.id,
        COALESCE(
          communities.display_name,
          communities.slug,
          candidates.host
        ) AS display_name,
        communities.slug,
        candidates.canonical_relay_url AS relay_url,
        connections.state AS connection_state,
        connections.health AS connection_health
      FROM communities
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      LEFT JOIN community_connections AS connections
        ON connections.community_id = communities.id
      WHERE communities.owner_pubkey = $1
        AND communities.claim_state = ANY($2::text[])
      ORDER BY display_name, communities.id
    `,
    [ownerPubkey, VERIFIED_CLAIM_STATES],
  );
  const owned = communities.rows.map(mapCommunitySummary);
  if (owned.length === 0) {
    return { channels: [], communities: [], destinations: [] };
  }

  const destinations = await pool.query<{
    connection_health: CommunityConnectionRecord["health"] | null;
    connection_state: CommunityConnectionRecord["state"] | null;
    display_name: string;
    featured: boolean;
    id: string;
    relay_url: string;
    slug: string | null;
  }>(
    `
      SELECT
        communities.id,
        COALESCE(
          communities.display_name,
          communities.slug,
          candidates.host
        ) AS display_name,
        communities.slug,
        candidates.canonical_relay_url AS relay_url,
        candidates.host = $2 AS featured,
        connections.state AS connection_state,
        connections.health AS connection_health
      FROM communities
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      JOIN community_connections AS connections
        ON connections.community_id = communities.id
      WHERE communities.claim_state = ANY($1::text[])
        AND communities.open_to_shared_channels = true
        AND connections.state = 'active'
      ORDER BY featured DESC, display_name, communities.id
    `,
    [VERIFIED_CLAIM_STATES, homeCommunityHost()],
  );

  const channels = await pool.query<{
    created_at: Date;
    id: string;
    own_community_id: string;
    own_endpoint_id: string;
    own_endpoint_state: SharedChannelEndpointRecord["state"];
    own_local_channel_id: string | null;
    own_local_channel_name: string | null;
    peer_community_id: string;
    peer_display_name: string;
    peer_endpoint_state: SharedChannelEndpointRecord["state"];
    peer_slug: string | null;
    proposed_by_community_id: string;
    proposed_name: string;
    purpose: string;
    state: SharedChannelRecord["state"];
  }>(
    `
      SELECT
        channels.id,
        channels.proposed_by_community_id,
        channels.proposed_name,
        channels.purpose,
        channels.state,
        channels.created_at,
        own_endpoint.id AS own_endpoint_id,
        own_endpoint.community_id AS own_community_id,
        own_endpoint.state AS own_endpoint_state,
        own_endpoint.local_channel_id AS own_local_channel_id,
        own_endpoint.local_channel_name_snapshot
          AS own_local_channel_name,
        peer_endpoint.community_id AS peer_community_id,
        peer_endpoint.state AS peer_endpoint_state,
        COALESCE(
          peer_community.display_name,
          peer_community.slug,
          peer_candidate.host
        ) AS peer_display_name,
        peer_community.slug AS peer_slug
      FROM shared_channels AS channels
      JOIN shared_channel_endpoints AS own_endpoint
        ON own_endpoint.shared_channel_id = channels.id
      JOIN shared_channel_endpoints AS peer_endpoint
        ON peer_endpoint.shared_channel_id = channels.id
        AND peer_endpoint.id <> own_endpoint.id
      JOIN communities AS peer_community
        ON peer_community.id = peer_endpoint.community_id
      JOIN community_candidates AS peer_candidate
        ON peer_candidate.id = peer_community.candidate_id
      WHERE own_endpoint.community_id = ANY($1::uuid[])
      ORDER BY channels.created_at DESC, channels.id
    `,
    [owned.map((community) => community.id)],
  );

  return {
    channels: channels.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      id: row.id,
      ownCommunityId: row.own_community_id,
      ownEndpointId: row.own_endpoint_id,
      ownEndpointState: row.own_endpoint_state,
      ownLocalChannelId: row.own_local_channel_id,
      ownLocalChannelName: row.own_local_channel_name,
      peerCommunityId: row.peer_community_id,
      peerDisplayName: row.peer_display_name,
      peerEndpointState: row.peer_endpoint_state,
      peerSlug: row.peer_slug,
      proposedByCommunityId: row.proposed_by_community_id,
      proposedName: row.proposed_name,
      purpose: row.purpose,
      state: row.state,
    })),
    communities: owned,
    destinations: destinations.rows.map(mapCommunitySummary),
  };
}

export async function listActiveConnectorConfigs(
  pool: Pool,
): Promise<ActiveConnectorConfig[]> {
  const connections = await pool.query<
    CommunityConnectionRow & {
      encrypted_private_key: Buffer;
      private_key_auth_tag: Buffer;
      private_key_nonce: Buffer;
    }
  >(
    `
      SELECT
        id,
        community_id,
        relay_url_snapshot,
        bridge_pubkey,
        encrypted_private_key,
        private_key_nonce,
        private_key_auth_tag,
        wrapping_key_version,
        state,
        health
      FROM community_connections
      WHERE state = 'active'
      ORDER BY id
    `,
  );
  if (connections.rows.length === 0) return [];

  const routes = await pool.query<{
    connection_id: string;
    last_event_created_at: string | number | null;
    local_channel_id: string;
    shared_channel_id: string;
    source_endpoint_id: string;
  }>(
    `
      SELECT
        endpoints.connection_id,
        endpoints.id AS source_endpoint_id,
        endpoints.shared_channel_id,
        endpoints.local_channel_id,
        endpoints.last_event_created_at
      FROM shared_channel_endpoints AS endpoints
      JOIN shared_channels AS channels
        ON channels.id = endpoints.shared_channel_id
      WHERE endpoints.connection_id = ANY($1::uuid[])
        AND endpoints.state = 'active'
        AND channels.state = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM shared_channel_endpoints AS peer
          WHERE peer.shared_channel_id = endpoints.shared_channel_id
            AND peer.state <> 'active'
        )
      ORDER BY endpoints.connection_id, endpoints.id
    `,
    [connections.rows.map((row) => row.id)],
  );
  const routesByConnection = new Map<string, ConnectorRouteConfig[]>();
  for (const route of routes.rows) {
    const connectionRoutes =
      routesByConnection.get(route.connection_id) ?? [];
    connectionRoutes.push({
      lastEventCreatedAt: Number(route.last_event_created_at ?? 0),
      localChannelId: route.local_channel_id,
      sharedChannelId: route.shared_channel_id,
      sourceEndpointId: route.source_endpoint_id,
    });
    routesByConnection.set(route.connection_id, connectionRoutes);
  }

  return connections.rows.map((row) => ({
    ...mapConnection(row),
    authTag: row.private_key_auth_tag,
    ciphertext: row.encrypted_private_key,
    nonce: row.private_key_nonce,
    routes: routesByConnection.get(row.id) ?? [],
  }));
}

export async function recordConnectionHealth(
  pool: Pool,
  connectionId: string,
  health: CommunityConnectionRecord["health"],
  error?: string,
): Promise<void> {
  await pool.query(
    `
      UPDATE community_connections
      SET health = $2,
          last_health_error = $3,
          last_health_at = now(),
          updated_at = now()
      WHERE id = $1
        AND state = 'active'
    `,
    [connectionId, health, error?.slice(0, 500) ?? null],
  );
}

export async function getBridgeDeliveryContext(
  pool: Pool,
  deliveryId: string,
): Promise<BridgeDeliveryContext | null> {
  const result = await pool.query<{
    attempts: number;
    body: string | null;
    delivery_id: string;
    destination_channel_id: string | null;
    destination_connection_id: string | null;
    destination_endpoint_id: string;
    destination_signed_event: Event | null;
    destination_state: SharedChannelEndpointRecord["state"];
    local_parent_event_id: string | null;
    message_id: string;
    route_state: SharedChannelRecord["state"];
    shared_channel_id: string;
    source_actor_pubkey: string;
    source_community_id: string;
    source_community_name: string;
    source_event_id: string;
    source_parent_event_id: string | null;
    source_state: SharedChannelEndpointRecord["state"];
    state: BridgeDeliveryContext["state"];
  }>(
    `
      SELECT
        deliveries.id AS delivery_id,
        deliveries.state,
        deliveries.attempts,
        deliveries.destination_signed_event,
        messages.id AS message_id,
        messages.shared_channel_id,
        messages.source_actor_pubkey,
        messages.source_event_id,
        messages.source_parent_event_id,
        messages.body,
        source_endpoint.community_id AS source_community_id,
        source_endpoint.state AS source_state,
        COALESCE(
          source_community.display_name,
          source_community.slug,
          source_candidate.host
        ) AS source_community_name,
        destination_endpoint.id AS destination_endpoint_id,
        destination_endpoint.connection_id AS destination_connection_id,
        destination_endpoint.local_channel_id AS destination_channel_id,
        destination_endpoint.state AS destination_state,
        channels.state AS route_state,
        destination_parent.local_event_id AS local_parent_event_id
      FROM bridge_deliveries AS deliveries
      JOIN bridge_messages AS messages
        ON messages.id = deliveries.bridge_message_id
      JOIN shared_channels AS channels
        ON channels.id = messages.shared_channel_id
      JOIN shared_channel_endpoints AS source_endpoint
        ON source_endpoint.id = messages.source_endpoint_id
      JOIN communities AS source_community
        ON source_community.id = source_endpoint.community_id
      JOIN community_candidates AS source_candidate
        ON source_candidate.id = source_community.candidate_id
      JOIN shared_channel_endpoints AS destination_endpoint
        ON destination_endpoint.id = deliveries.destination_endpoint_id
      LEFT JOIN bridge_event_mappings AS source_parent
        ON source_parent.endpoint_id = source_endpoint.id
        AND source_parent.local_event_id = messages.source_parent_event_id
      LEFT JOIN bridge_event_mappings AS destination_parent
        ON destination_parent.endpoint_id = destination_endpoint.id
        AND destination_parent.bridge_message_id = COALESCE(
          messages.parent_bridge_message_id,
          source_parent.bridge_message_id
        )
      WHERE deliveries.id = $1
    `,
    [deliveryId],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (
    !row.body ||
    !row.destination_connection_id ||
    !row.destination_channel_id
  ) {
    throw new ApiError(
      "delivery_context_invalid",
      "The bridge delivery is incomplete.",
      500,
    );
  }

  return {
    attempts: row.attempts,
    body: row.body,
    deliveryId: row.delivery_id,
    destinationChannelId: row.destination_channel_id,
    destinationConnectionId: row.destination_connection_id,
    destinationEndpointId: row.destination_endpoint_id,
    destinationEvent: row.destination_signed_event,
    localParentEventId: row.local_parent_event_id,
    messageId: row.message_id,
    routeActive:
      row.route_state === "active" &&
      row.source_state === "active" &&
      row.destination_state === "active",
    sharedChannelId: row.shared_channel_id,
    sourceActorPubkey: row.source_actor_pubkey,
    sourceCommunityId: row.source_community_id,
    sourceCommunityName: row.source_community_name,
    sourceEventId: row.source_event_id,
    sourceParentEventId: row.source_parent_event_id,
    state: row.state,
  };
}

export async function markBridgeDeliveryDelivering(
  pool: Pool,
  deliveryId: string,
): Promise<boolean> {
  const result = await pool.query<{ id: string }>(
    `
      UPDATE bridge_deliveries
      SET state = 'delivering',
          attempts = attempts + 1,
          updated_at = now()
      WHERE id = $1
        AND state IN ('queued', 'retry', 'delivering')
      RETURNING id
    `,
    [deliveryId],
  );
  return Boolean(result.rows[0]);
}

export async function isBridgeDeliveryRouteActive(
  pool: Pool,
  deliveryId: string,
): Promise<boolean> {
  const result = await pool.query<{ active: boolean }>(
    `
      SELECT (
        channels.state = 'active' AND
        source_endpoint.state = 'active' AND
        destination_endpoint.state = 'active'
      ) AS active
      FROM bridge_deliveries AS deliveries
      JOIN bridge_messages AS messages
        ON messages.id = deliveries.bridge_message_id
      JOIN shared_channels AS channels
        ON channels.id = messages.shared_channel_id
      JOIN shared_channel_endpoints AS source_endpoint
        ON source_endpoint.id = messages.source_endpoint_id
      JOIN shared_channel_endpoints AS destination_endpoint
        ON destination_endpoint.id = deliveries.destination_endpoint_id
      WHERE deliveries.id = $1
        AND deliveries.state = 'delivering'
    `,
    [deliveryId],
  );
  return result.rows[0]?.active === true;
}

export async function persistDestinationEvent(
  pool: Pool,
  deliveryId: string,
  event: Event,
): Promise<Event> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<{
      destination_signed_event: Event | null;
      state: BridgeDeliveryContext["state"];
    }>(
      `
        SELECT destination_signed_event, state
        FROM bridge_deliveries
        WHERE id = $1
        FOR UPDATE
      `,
      [deliveryId],
    );
    const delivery = current.rows[0];
    if (!delivery) {
      throw new ApiError(
        "delivery_not_found",
        "The bridge delivery is unavailable.",
        404,
      );
    }
    if (
      delivery.state === "cancelled" ||
      delivery.state === "failed"
    ) {
      throw new ApiError(
        "delivery_terminal",
        "The bridge delivery is terminal.",
        409,
      );
    }
    if (delivery.destination_signed_event) {
      return delivery.destination_signed_event;
    }

    await client.query(
      `
        UPDATE bridge_deliveries
        SET destination_signed_event = $2,
            destination_event_id = $3,
            updated_at = now()
        WHERE id = $1
      `,
      [deliveryId, event, event.id],
    );
    return event;
  });
}

export async function completeBridgeDelivery(
  pool: Pool,
  deliveryId: string,
  event: Event,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const result = await client.query<{
      bridge_message_id: string;
      destination_endpoint_id: string;
      shared_channel_id: string;
    }>(
      `
        UPDATE bridge_deliveries AS deliveries
        SET state = 'delivered_to_relay',
            delivered_at = now(),
            terminal_error_code = NULL,
            updated_at = now()
        FROM bridge_messages AS messages
        WHERE deliveries.id = $1
          AND deliveries.bridge_message_id = messages.id
          AND deliveries.destination_event_id = $2
          AND deliveries.state <> 'cancelled'
        RETURNING
          deliveries.bridge_message_id,
          deliveries.destination_endpoint_id,
          messages.shared_channel_id
      `,
      [deliveryId, event.id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(
        "delivery_completion_conflict",
        "The bridge delivery could not be completed.",
        409,
      );
    }
    await client.query(
      `
        INSERT INTO bridge_event_mappings (
          shared_channel_id,
          endpoint_id,
          bridge_message_id,
          local_event_id
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (endpoint_id, bridge_message_id) DO NOTHING
      `,
      [
        row.shared_channel_id,
        row.destination_endpoint_id,
        row.bridge_message_id,
        event.id,
      ],
    );
  });
}

export async function markBridgeDeliveryRetry(
  pool: Pool,
  deliveryId: string,
  errorCode: string,
  terminal = false,
): Promise<void> {
  await pool.query(
    `
      UPDATE bridge_deliveries
      SET state = $2,
          terminal_error_code = $3,
          next_attempt_at = CASE
            WHEN $2 = 'retry'
              THEN now() + make_interval(
                secs => LEAST(900, 15 * (2 ^ LEAST(attempts, 6)))
              )
            ELSE next_attempt_at
          END,
          updated_at = now()
      WHERE id = $1
        AND state <> 'delivered_to_relay'
        AND state <> 'cancelled'
    `,
    [deliveryId, terminal ? "failed" : "retry", errorCode.slice(0, 80)],
  );
}

export async function cancelBridgeDelivery(
  pool: Pool,
  deliveryId: string,
  reason = "route_inactive",
): Promise<void> {
  await pool.query(
    `
      UPDATE bridge_deliveries
      SET state = 'cancelled',
          terminal_error_code = $2,
          updated_at = now()
      WHERE id = $1
        AND state <> 'delivered_to_relay'
    `,
    [deliveryId, reason.slice(0, 80)],
  );
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

function mapCommunitySummary(row: {
  connection_health: CommunityConnectionRecord["health"] | null;
  connection_state: CommunityConnectionRecord["state"] | null;
  display_name: string;
  featured?: boolean;
  id: string;
  relay_url: string;
  slug: string | null;
}): SharedChannelCommunitySummary {
  return {
    connectionHealth: row.connection_health,
    connectionState: row.connection_state,
    displayName: row.display_name,
    featured: row.featured ?? false,
    id: row.id,
    relayUrl: row.relay_url,
    slug: row.slug,
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
