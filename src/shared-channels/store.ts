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

export interface SharedChannelEndpointRecord {
  communityId: string;
  connectionId: string | null;
  id: string;
  localChannelId: string | null;
  localChannelName: string | null;
  role: "participant";
  sends: boolean;
  receives: boolean;
  filterMode: HubFilterMode;
  filterList: string[];
  sharedChannelId: string;
  state: "active";
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

/** The one exact relay origin where BuzzRouter's bridge has an admin role. */
export function homeCommunityRelayUrl(): string {
  return (
    process.env.BUZZROUTER_HOME_RELAY_URL?.trim() ||
    `wss://${homeCommunityHost()}`
  );
}

/**
 * The NIP-29 id of BuzzRouter's operated `general` channel. Production sets
 * the real UUID; `general` remains the local/fake-relay default.
 */
export function homeCommunityChannelId(): string {
  return process.env.BUZZROUTER_HOME_CHANNEL_ID?.trim() || "general";
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

export interface IngestBridgeMessageInput {
  body: string;
  bodySha256: string;
  /**
   * The single community the author addressed. Routing is point-to-point: a
   * message goes where it is sent, never to every participant. Omit only for
   * callers that predate addressing (tests), which keep the old fan-out.
   */
  destinationCommunityId?: string;
  messageId: string;
  parentBridgeMessageId?: string;
  sharedChannelId: string;
  signedEvent: unknown;
  sourceActorPubkey: string;
  sourceActorName?: string;
  sourceCreatedAt: number;
  sourceEndpointId: string;
  sourceEventId: string;
  sourceParentEventId?: string;
}

export interface IngestBridgeMessageResult {
  created: boolean;
  deliveryId: string;
  deliveryIds: string[];
  messageId: string;
}

export type HubFilterMode = "everyone_except" | "only_these";

export interface HubMemberSummary {
  communityId: string;
  displayName: string;
}

export interface HubMembership {
  communityId: string;
  endpointId: string;
  filterList: string[];
  filterMode: HubFilterMode;
  localChannelId: string;
  localChannelName: string;
  members: HubMemberSummary[];
  recentOutcomes: HubDeliveryOutcome[];
  receives: boolean;
  sends: boolean;
  sharedChannelId: string;
}

export interface HubDeliveryOutcome {
  communityId: string;
  communityName: string;
  errorCode: string | null;
  messageId: string;
  state: BridgeDeliveryContext["state"];
  updatedAt: string;
}

export interface JoinOpenHubInput {
  communityId: string;
  localChannelId: string;
  localChannelName: string;
  ownerPubkey: string;
}

export interface UpdateHubSettingsInput {
  communityId: string;
  filterList: string[];
  filterMode: HubFilterMode;
  localChannelId?: string;
  localChannelName?: string;
  ownerPubkey: string;
  receives: boolean;
  sends: boolean;
}

export interface ConnectorRouteConfig {
  lastEventCreatedAt: number;
  localChannelId: string;
  sharedChannelId: string;
  sourceEndpointId: string;
  /**
   * When set, this channel is a direct channel bound to exactly one peer.
   * A message typed here routes to that community untagged — the channel is
   * the address. When null it is an inbox channel and needs `@community`.
   */
  dedicatedToCommunityId: string | null;
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
  sourceActorName: string | null;
  sourceCommunityId: string;
  sourceCommunityName: string;
  sourceCommunitySlug: string;
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

interface SharedChannelEndpointRow {
  community_id: string;
  connection_id: string | null;
  id: string;
  filter_list?: string[];
  filter_mode?: HubFilterMode;
  local_channel_id: string | null;
  local_channel_name_snapshot: string | null;
  receives?: boolean;
  sends?: boolean;
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

export interface OwnedConnectorConnection
  extends CommunityConnectionRecord,
    EncryptedConnectorKey {}

/**
 * The active connector connection for a community the caller verifiably owns,
 * including its encrypted key so a request can open the same authenticated
 * relay session the connector uses. Throws {@link ApiError} `community_owner_required`
 * when the caller is not the verified owner; returns `null` when the community
 * is owned but has no active connector yet.
 */
export async function getOwnedCommunityConnection(
  pool: Pool,
  input: { communityId: string; ownerPubkey: string },
): Promise<OwnedConnectorConnection | null> {
  assertHex(input.ownerPubkey, 64, "Owner public key");
  const result = await pool.query<
    CommunityConnectionRow & {
      community_owned: boolean;
      connection_id: string | null;
      encrypted_private_key: Buffer | null;
      private_key_auth_tag: Buffer | null;
      private_key_nonce: Buffer | null;
    }
  >(
    `
      SELECT
        communities.id AS community_id,
        connections.id AS connection_id,
        connections.relay_url_snapshot,
        connections.bridge_pubkey,
        connections.encrypted_private_key,
        connections.private_key_nonce,
        connections.private_key_auth_tag,
        connections.wrapping_key_version,
        connections.state,
        connections.health
      FROM communities
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      LEFT JOIN community_connections AS connections
        ON connections.community_id = communities.id
        AND connections.state = 'active'
      WHERE communities.id = $1
        AND communities.owner_pubkey = $2
        AND candidates.state = 'verified_buzz'
    `,
    [input.communityId, input.ownerPubkey],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "community_owner_required",
      "Verified community ownership is required.",
      403,
    );
  }
  if (
    !row.connection_id ||
    !row.encrypted_private_key ||
    !row.private_key_nonce ||
    !row.private_key_auth_tag
  ) {
    return null;
  }
  return {
    ...mapConnection({ ...row, id: row.connection_id }),
    authTag: row.private_key_auth_tag,
    ciphertext: row.encrypted_private_key,
    nonce: row.private_key_nonce,
  };
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
            AND endpoints.sends = true
            AND channels.state = 'active'
          FOR SHARE OF endpoints, channels
        `,
        [input.sourceEndpointId, input.sharedChannelId],
      );
    if (!endpointResult.rows[0]) {
      throw new ApiError(
        "route_inactive",
        "The hub connection is not active.",
        409,
      );
    }

    const destinationResult =
      await client.query<SharedChannelEndpointRow>(
        `
          SELECT
            destination.id,
            destination.shared_channel_id,
            destination.community_id,
            destination.connection_id,
            destination.role,
            destination.state,
            destination.local_channel_id,
            destination.local_channel_name_snapshot
          FROM shared_channel_endpoints AS destination
          JOIN shared_channel_endpoints AS source ON source.id = $2
          WHERE destination.shared_channel_id = $1
            AND destination.id <> $2
            AND destination.state = 'active'
            AND destination.receives = true
            AND ($4::uuid IS NULL OR destination.community_id = $4)
            -- An endpoint dedicated to one peer exchanges with that peer only,
            -- in both directions. Without this a message addressed to a
            -- community that holds several endpoints would be copied into every
            -- one of them, which is how another peer's dedicated channel would
            -- end up holding this conversation.
            AND (
              destination.dedicated_to_community_id IS NULL OR
              destination.dedicated_to_community_id = source.community_id
            )
            AND (
              source.dedicated_to_community_id IS NULL OR
              source.dedicated_to_community_id = destination.community_id
            )
            -- The ordinary endpoint yields to a dedicated one for this source,
            -- so the shared channel stays the fallback for a peer whose
            -- dedicated channel does not exist (yet) rather than a second copy.
            AND (
              destination.dedicated_to_community_id IS NOT NULL OR
              NOT EXISTS (
                SELECT 1
                FROM shared_channel_endpoints AS dedicated
                WHERE dedicated.shared_channel_id = destination.shared_channel_id
                  AND dedicated.community_id = destination.community_id
                  AND dedicated.dedicated_to_community_id = source.community_id
                  AND dedicated.state = 'active'
                  AND dedicated.receives = true
              )
            )
            AND (
              (destination.filter_mode = 'everyone_except'
                AND NOT ($3::uuid = ANY(destination.filter_list)))
              OR
              (destination.filter_mode = 'only_these'
                AND $3::uuid = ANY(destination.filter_list))
            )
            AND (
              (source.filter_mode = 'everyone_except'
                AND NOT (destination.community_id = ANY(source.filter_list)))
              OR
              (source.filter_mode = 'only_these'
                AND destination.community_id = ANY(source.filter_list))
            )
          FOR SHARE
        `,
        [
          input.sharedChannelId,
          input.sourceEndpointId,
          endpointResult.rows[0].community_id,
          input.destinationCommunityId ?? null,
        ],
      );
    const destinations = destinationResult.rows;
    if (destinations.length === 0) {
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
          source_actor_name,
          source_created_at,
          source_signed_event,
          source_parent_event_id,
          parent_bridge_message_id,
          body,
          body_sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        input.sourceActorName ?? null,
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
        deliveryIds: existing.rows.map((delivery) => delivery.delivery_id),
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
        SELECT $1, destination_id
        FROM unnest($2::uuid[]) AS destination_id
        RETURNING id
      `,
      [input.messageId, destinations.map((destination) => destination.id)],
    );
    const deliveryIds = deliveryResult.rows.map((delivery) => delivery.id);
    const deliveryId = deliveryIds[0];
    const transactionDb = {
      executeSql: async (text: string, values?: unknown[]) => {
        const result = await client.query(text, values);
        return { rows: result.rows };
      },
    };
    for (const [index, queuedDeliveryId] of deliveryIds.entries()) {
      const jobId = await boss.send(
        BRIDGE_DELIVERY_QUEUE,
        { deliveryId: queuedDeliveryId },
        {
          db: transactionDb,
          id: index === 0
            ? input.messageId
            : queuedDeliveryId,
        },
      );
      if (!jobId) {
        throw new ApiError(
          "message_enqueue_failed",
          "The message could not be queued.",
          500,
        );
      }
    }

    return {
      created: true,
      deliveryId,
      deliveryIds,
      messageId: input.messageId,
    };
  });
}

export interface VerifiedCommunityIdentity {
  communityId: string;
  displayName: string;
  ownerPubkey: string;
  relayUrl: string;
}

export interface VerifiedCommunityCandidate {
  candidateId: string;
  communityId: string | null;
  displayName: string;
  ownerPubkey: string | null;
  relayUrl: string;
}

/**
 * Resolve a verified candidate without mutating it. The unsigned invite flow
 * performs this lookup before redeeming the invite, so invalid or expired
 * links cannot create community or connector state.
 */
export async function findVerifiedCommunityCandidateByRelayUrl(
  pool: Pool,
  canonicalRelayUrl: string,
): Promise<VerifiedCommunityCandidate> {
  const result = await pool.query<{
    community_id: string | null;
    display_name: string;
    candidate_id: string;
    owner_pubkey: string | null;
    relay_url: string;
  }>(
    `
      SELECT
        candidates.id AS candidate_id,
        communities.id AS community_id,
        communities.owner_pubkey,
        COALESCE(communities.display_name, communities.slug, candidates.host)
          AS display_name,
        candidates.canonical_relay_url AS relay_url
      FROM community_candidates AS candidates
      LEFT JOIN communities
        ON communities.candidate_id = candidates.id
      WHERE candidates.canonical_relay_url = $1
        AND candidates.state = 'verified_buzz'
      LIMIT 1
    `,
    [canonicalRelayUrl],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "invite_community_unknown",
      "That invite link is for a community BuzzRouter has not verified yet. List it first.",
      404,
    );
  }
  return {
    candidateId: row.candidate_id,
    communityId: row.community_id,
    displayName: row.display_name,
    ownerPubkey: row.owner_pubkey,
    relayUrl: row.relay_url,
  };
}

/** Enroll only after the relay has accepted the pasted invite. */
export async function enrollVerifiedCommunityFromInvite(
  pool: Pool,
  candidateId: string,
  suggestedOwnerPubkey: string,
): Promise<VerifiedCommunityIdentity> {
  assertHex(suggestedOwnerPubkey, 64, "Session principal");
  const result = await pool.query<{
    display_name: string;
    id: string;
    owner_pubkey: string;
    relay_url: string;
  }>(
    `
      WITH enrolled AS (
        INSERT INTO communities (candidate_id, owner_pubkey)
        SELECT id, $2
        FROM community_candidates
        WHERE id = $1
          AND state = 'verified_buzz'
        ON CONFLICT (candidate_id) DO UPDATE
          SET owner_pubkey = COALESCE(
                communities.owner_pubkey,
                EXCLUDED.owner_pubkey
              ),
              updated_at = now()
        RETURNING id, candidate_id, owner_pubkey, display_name, slug
      )
      SELECT
        enrolled.id,
        enrolled.owner_pubkey,
        COALESCE(enrolled.display_name, enrolled.slug, candidates.host)
          AS display_name,
        candidates.canonical_relay_url AS relay_url
      FROM enrolled
      JOIN community_candidates AS candidates
        ON candidates.id = enrolled.candidate_id
    `,
    [candidateId, suggestedOwnerPubkey],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "invite_community_unknown",
      "That community is no longer verified. Try again after verification.",
      409,
    );
  }
  return {
    communityId: row.id,
    displayName: row.display_name,
    ownerPubkey: row.owner_pubkey,
    relayUrl: row.relay_url,
  };
}

/**
 * Add one bidirectional participant endpoint to the single open hub. Every
 * connection uses this shared-channel row and the ordinary delivery pipeline.
 * Pasting an owner/admin invite is the authorization, so there is deliberately
 * no proposal, acceptance, or chat confirmation ceremony here.
 */
export async function joinOpenHub(
  pool: Pool,
  input: JoinOpenHubInput,
): Promise<HubMembership> {
  assertText(input.localChannelId, 1, 200, "Local channel");
  assertText(input.localChannelName, 1, 80, "Local channel name");

  await withTransaction(pool, async (client) => {
    const owner = await requireVerifiedOwner(
      client,
      input.communityId,
      input.ownerPubkey,
    );
    const connection = await requireActiveConnection(client, input.communityId);
    // Without a handle a participant is unaddressable, so joining the hub and
    // getting one are the same event.
    await ensureCommunitySlug(client, input.communityId);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('open-buzzrouter-hub', 0))",
    );

    const existingMembership = await client.query<{ id: string }>(
      `
        SELECT endpoints.id
        FROM shared_channel_endpoints AS endpoints
        JOIN shared_channels AS channels
          ON channels.id = endpoints.shared_channel_id
        WHERE channels.mode = 'hub'
          AND endpoints.community_id = $1
          AND endpoints.state <> 'disconnected'
      `,
      [input.communityId],
    );
    if (existingMembership.rows[0]) return;

    await assertChannelNotRouted(client, input.communityId, input.localChannelId);

    let hub = await client.query<{ id: string }>(
      "SELECT id FROM shared_channels WHERE mode = 'hub' FOR UPDATE",
    );
    if (!hub.rows[0]) {
      const home = await client.query<{
        community_id: string;
        connection_id: string;
        relay_url: string;
      }>(
        `
          SELECT communities.id AS community_id,
                 connections.id AS connection_id,
                 connections.relay_url_snapshot AS relay_url
          FROM communities
          JOIN community_candidates AS candidates
            ON candidates.id = communities.candidate_id
          JOIN community_connections AS connections
            ON connections.community_id = communities.id
          WHERE candidates.host = $1
            AND candidates.state = 'verified_buzz'
            AND connections.state = 'active'
            AND communities.owner_pubkey IS NOT NULL
          ORDER BY communities.id
          LIMIT 1
        `,
        [homeCommunityHost()],
      );
      const featured = home.rows[0];
      if (!featured) {
        throw new ApiError(
          "featured_unavailable",
          "The open BuzzRouter channel is not accepting links right now.",
          503,
        );
      }
      const created = await client.query<{ id: string }>(
        `
          INSERT INTO shared_channels (state, mode)
          VALUES ('active', 'hub')
          RETURNING id
        `,
      );
      hub = created;
      await client.query(
        `
          INSERT INTO shared_channel_endpoints (
            shared_channel_id, community_id, connection_id, role, state,
            relay_url_snapshot, local_channel_id,
            local_channel_name_snapshot, last_event_created_at, sends, receives
          )
          VALUES ($1, $2, $3, 'participant', 'active', $4, $5,
                  'general', floor(extract(epoch FROM now()))::bigint,
                  true, true)
        `,
        [
          created.rows[0].id,
          featured.community_id,
          featured.connection_id,
          featured.relay_url,
          homeCommunityChannelId(),
        ],
      );
      if (featured.community_id === input.communityId) return;
    }

    await client.query(
      `
        INSERT INTO shared_channel_endpoints (
          shared_channel_id, community_id, connection_id, role, state,
          relay_url_snapshot, local_channel_id,
          local_channel_name_snapshot, last_event_created_at, sends, receives,
          filter_mode, filter_list
        )
        VALUES ($1, $2, $3, 'participant', 'active', $4, $5, $6,
                floor(extract(epoch FROM now()))::bigint,
                true, true, 'everyone_except', '{}')
      `,
      [
        hub.rows[0].id,
        input.communityId,
        connection.id,
        owner.relayUrl,
        input.localChannelId,
        input.localChannelName,
      ],
    );
  });

  return getOpenHubMembership(pool, input.communityId, input.ownerPubkey);
}

export async function getOpenHubMembership(
  pool: Pool,
  communityId: string,
  ownerPubkey: string,
): Promise<HubMembership> {
  assertHex(ownerPubkey, 64, "Owner public key");
  const result = await pool.query<{
    endpoint_id: string;
    filter_list: string[];
    filter_mode: HubFilterMode;
    local_channel_id: string;
    local_channel_name: string;
    receives: boolean;
    sends: boolean;
    shared_channel_id: string;
  }>(
    `
      SELECT endpoints.id AS endpoint_id, endpoints.shared_channel_id,
             endpoints.local_channel_id,
             endpoints.local_channel_name_snapshot AS local_channel_name,
             endpoints.sends, endpoints.receives,
             endpoints.filter_mode, endpoints.filter_list
      FROM shared_channel_endpoints AS endpoints
      JOIN shared_channels AS channels
        ON channels.id = endpoints.shared_channel_id
      JOIN communities ON communities.id = endpoints.community_id
      WHERE channels.mode = 'hub'
        AND endpoints.community_id = $1
        AND endpoints.state = 'active'
        AND endpoints.dedicated_to_community_id IS NULL
        AND communities.owner_pubkey = $2
    `,
    [communityId, ownerPubkey],
  );
  const membership = result.rows[0];
  if (!membership) {
    throw new ApiError(
      "hub_membership_not_found",
      "This community is not connected to the open BuzzRouter hub.",
      404,
    );
  }
  const members = await pool.query<HubMemberSummary & { community_id: string; display_name: string }>(
    `
      SELECT endpoints.community_id,
             COALESCE(communities.display_name, communities.slug, candidates.host)
               AS display_name
      FROM shared_channel_endpoints AS endpoints
      JOIN communities ON communities.id = endpoints.community_id
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      WHERE endpoints.shared_channel_id = $1
        AND endpoints.state = 'active'
        -- One row per member community: a community that also holds dedicated
        -- per-peer endpoints is still one member of the hub.
        AND endpoints.dedicated_to_community_id IS NULL
        AND endpoints.community_id <> $2
      ORDER BY display_name, endpoints.community_id
    `,
    [membership.shared_channel_id, communityId],
  );
  const outcomes = await pool.query<{
    community_id: string;
    community_name: string;
    message_id: string;
    state: BridgeDeliveryContext["state"];
    terminal_error_code: string | null;
    updated_at: Date;
  }>(
    `
      SELECT destination.community_id,
             COALESCE(communities.display_name, communities.slug, candidates.host)
               AS community_name,
             deliveries.bridge_message_id AS message_id,
             deliveries.state, deliveries.terminal_error_code,
             deliveries.updated_at
      FROM bridge_messages AS messages
      JOIN bridge_deliveries AS deliveries
        ON deliveries.bridge_message_id = messages.id
      JOIN shared_channel_endpoints AS destination
        ON destination.id = deliveries.destination_endpoint_id
      JOIN communities ON communities.id = destination.community_id
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      WHERE messages.source_endpoint_id = $1
      ORDER BY deliveries.updated_at DESC, deliveries.id
      LIMIT 50
    `,
    [membership.endpoint_id],
  );
  return {
    communityId,
    endpointId: membership.endpoint_id,
    filterList: membership.filter_list,
    filterMode: membership.filter_mode,
    localChannelId: membership.local_channel_id,
    localChannelName: membership.local_channel_name,
    members: members.rows.map((row) => ({
      communityId: row.community_id,
      displayName: row.display_name,
    })),
    receives: membership.receives,
    recentOutcomes: outcomes.rows.map((row) => ({
      communityId: row.community_id,
      communityName: row.community_name,
      errorCode: row.terminal_error_code,
      messageId: row.message_id,
      state: row.state,
      updatedAt: row.updated_at.toISOString(),
    })),
    sends: membership.sends,
    sharedChannelId: membership.shared_channel_id,
  };
}

export async function updateOpenHubSettings(
  pool: Pool,
  input: UpdateHubSettingsInput,
): Promise<HubMembership> {
  if (input.filterMode !== "everyone_except" && input.filterMode !== "only_these") {
    throw new ApiError("invalid_input", "The filter mode is invalid.");
  }
  const changesChannel =
    input.localChannelId !== undefined || input.localChannelName !== undefined;
  if (changesChannel) {
    assertText(input.localChannelId ?? "", 1, 200, "Local channel");
    assertText(input.localChannelName ?? "", 1, 80, "Local channel name");
  }
  const filterList = [...new Set(input.filterList)];
  for (const communityId of filterList) assertUuid(communityId, "Filter community");
  await withTransaction(pool, async (client) => {
    await requireVerifiedOwner(client, input.communityId, input.ownerPubkey);
    const own = await client.query<{
      id: string;
      local_channel_id: string;
    }>(
      `
        SELECT endpoints.id, endpoints.local_channel_id
        FROM shared_channel_endpoints AS endpoints
        JOIN shared_channels AS channels
          ON channels.id = endpoints.shared_channel_id
        WHERE channels.mode = 'hub'
          AND endpoints.community_id = $1
          AND endpoints.state = 'active'
          AND endpoints.dedicated_to_community_id IS NULL
      `,
      [input.communityId],
    );
    const ownEndpoint = own.rows[0];
    if (!ownEndpoint) {
      throw new ApiError("hub_membership_not_found", "Hub membership was not found.", 404);
    }
    if (
      changesChannel &&
      input.localChannelId !== ownEndpoint.local_channel_id
    ) {
      await assertChannelNotRouted(
        client,
        input.communityId,
        input.localChannelId!,
        ownEndpoint.id,
      );
    }
    const valid = await client.query<{ id: string }>(
      `
        SELECT endpoints.community_id AS id
        FROM shared_channel_endpoints AS own
        JOIN shared_channels AS channels ON channels.id = own.shared_channel_id
        JOIN shared_channel_endpoints AS endpoints
          ON endpoints.shared_channel_id = own.shared_channel_id
        WHERE channels.mode = 'hub'
          AND own.community_id = $1
          AND own.state = 'active'
          AND own.dedicated_to_community_id IS NULL
          AND endpoints.state = 'active'
          -- Count member communities, not endpoints: a community with dedicated
          -- per-peer endpoints must not be counted several times, or a valid
          -- filter list would be rejected as containing unknown communities.
          AND endpoints.dedicated_to_community_id IS NULL
          AND endpoints.community_id = ANY($2::uuid[])
      `,
      [input.communityId, filterList],
    );
    if (valid.rows.length !== filterList.length || filterList.includes(input.communityId)) {
      throw new ApiError(
        "hub_filter_invalid",
        "The filter can only contain other active hub communities.",
      );
    }
    const updated = await client.query(
      `
        UPDATE shared_channel_endpoints AS endpoints
        SET sends = $2, receives = $3, filter_mode = $4,
            filter_list = $5::uuid[],
            local_channel_id = COALESCE($6, endpoints.local_channel_id),
            local_channel_name_snapshot = COALESCE(
              $7,
              endpoints.local_channel_name_snapshot
            ),
            last_event_created_at = CASE
              WHEN $6 IS NULL OR $6 = endpoints.local_channel_id
                THEN endpoints.last_event_created_at
              ELSE floor(extract(epoch FROM now()))::bigint
            END,
            updated_at = now()
        FROM shared_channels AS channels
        WHERE endpoints.shared_channel_id = channels.id
          AND channels.mode = 'hub'
          AND endpoints.community_id = $1
          AND endpoints.state = 'active'
          AND endpoints.dedicated_to_community_id IS NULL
        RETURNING endpoints.id
      `,
      [
        input.communityId,
        input.sends,
        input.receives,
        input.filterMode,
        filterList,
        input.localChannelId ?? null,
        input.localChannelName ?? null,
      ],
    );
    if (!updated.rows[0]) {
      throw new ApiError("hub_membership_not_found", "Hub membership was not found.", 404);
    }
  });
  return getOpenHubMembership(pool, input.communityId, input.ownerPubkey);
}

export interface HubHomeEndpoint {
  communityId: string;
  ownerPubkey: string;
  sharedChannelId: string;
}

/**
 * BuzzRouter's own ordinary hub endpoint — the `general` participant on the
 * relay we operate — together with the owner key needed to create channels
 * there. Returns null before the hub exists or while our own connector is down,
 * which is a reason to do nothing rather than an error.
 */
export async function getHubHomeEndpoint(
  pool: Pool,
): Promise<HubHomeEndpoint | null> {
  const result = await pool.query<{
    community_id: string;
    owner_pubkey: string;
    shared_channel_id: string;
  }>(
    `
      SELECT endpoints.community_id,
             endpoints.shared_channel_id,
             communities.owner_pubkey
      FROM shared_channel_endpoints AS endpoints
      JOIN shared_channels AS channels
        ON channels.id = endpoints.shared_channel_id
      JOIN communities ON communities.id = endpoints.community_id
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      WHERE channels.mode = 'hub'
        AND channels.state = 'active'
        AND endpoints.state = 'active'
        AND endpoints.dedicated_to_community_id IS NULL
        AND candidates.host = $1
        AND communities.owner_pubkey IS NOT NULL
      ORDER BY endpoints.community_id
      LIMIT 1
    `,
    [homeCommunityHost()],
  );
  const row = result.rows[0];
  return row
    ? {
        communityId: row.community_id,
        ownerPubkey: row.owner_pubkey,
        sharedChannelId: row.shared_channel_id,
      }
    : null;
}

/**
 * Any hub participant's own ordinary inbox endpoint — the `dedicated_to_community_id
 * IS NULL` participant — together with the owner key needed to create a channel
 * on that community's relay. This is {@link getHubHomeEndpoint} generalized off
 * BuzzRouter's own community to ANY community, so the `/open` command can create
 * a direct channel in the requester's own community and bind it with
 * {@link attachDedicatedPeerChannel}. Null when the community has no active inbox
 * endpoint or no owner on record, which is a reason to decline rather than error.
 */
export async function getCommunityInboxEndpoint(
  pool: Pool,
  communityId: string,
): Promise<HubHomeEndpoint | null> {
  const result = await pool.query<{
    community_id: string;
    owner_pubkey: string;
    shared_channel_id: string;
  }>(
    `
      SELECT endpoints.community_id,
             endpoints.shared_channel_id,
             communities.owner_pubkey
      FROM shared_channel_endpoints AS endpoints
      JOIN shared_channels AS channels
        ON channels.id = endpoints.shared_channel_id
      JOIN communities ON communities.id = endpoints.community_id
      WHERE channels.mode = 'hub'
        AND channels.state = 'active'
        AND endpoints.state = 'active'
        AND endpoints.dedicated_to_community_id IS NULL
        AND endpoints.community_id = $1
        AND communities.owner_pubkey IS NOT NULL
      LIMIT 1
    `,
    [communityId],
  );
  const row = result.rows[0];
  return row
    ? {
        communityId: row.community_id,
        ownerPubkey: row.owner_pubkey,
        sharedChannelId: row.shared_channel_id,
      }
    : null;
}

/**
 * Hub participants that BuzzRouter does not yet hold a dedicated channel for,
 * oldest first. This is what makes the change retroactive: an already-connected
 * community is simply one that has been waiting the longest.
 */
export async function listHubPeersMissingDedicatedChannel(
  pool: Pool,
  home: HubHomeEndpoint,
  limit: number,
): Promise<string[]> {
  const result = await pool.query<{ community_id: string }>(
    `
      SELECT peer.community_id
      FROM shared_channel_endpoints AS peer
      WHERE peer.shared_channel_id = $1
        AND peer.state = 'active'
        AND peer.dedicated_to_community_id IS NULL
        AND peer.community_id <> $2
        AND NOT EXISTS (
          SELECT 1
          FROM shared_channel_endpoints AS dedicated
          WHERE dedicated.shared_channel_id = peer.shared_channel_id
            AND dedicated.community_id = $2
            AND dedicated.dedicated_to_community_id = peer.community_id
        )
      ORDER BY peer.created_at, peer.id
      LIMIT $3
    `,
    [home.sharedChannelId, home.communityId, limit],
  );
  return result.rows.map((row) => row.community_id);
}

/**
 * Bind a freshly created channel on our own relay as BuzzRouter's dedicated
 * endpoint for one peer.
 *
 * Runs after the channel handoff has completed, so a crash in between leaves an
 * orphaned (already owner-transferred) channel that the next pass reuses via the
 * handoff journal rather than an endpoint pointing at a channel we still own.
 */
export async function attachDedicatedPeerChannel(
  pool: Pool,
  input: {
    home: HubHomeEndpoint;
    localChannelId: string;
    localChannelName: string;
    peerCommunityId: string;
  },
): Promise<boolean> {
  assertText(input.localChannelId, 1, 200, "Local channel");
  assertText(input.localChannelName, 1, 80, "Local channel name");
  const result = await pool.query(
    `
      INSERT INTO shared_channel_endpoints (
        shared_channel_id, community_id, connection_id, role, state,
        relay_url_snapshot, local_channel_id, local_channel_name_snapshot,
        last_event_created_at, sends, receives, filter_mode, filter_list,
        dedicated_to_community_id
      )
      SELECT home.shared_channel_id, home.community_id, home.connection_id,
             'participant', 'active', home.relay_url_snapshot, $3, $4,
             floor(extract(epoch FROM now()))::bigint, true, true,
             'everyone_except', '{}', $2
      FROM shared_channel_endpoints AS home
      WHERE home.shared_channel_id = $5
        AND home.community_id = $1
        AND home.state = 'active'
        AND home.dedicated_to_community_id IS NULL
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    [
      input.home.communityId,
      input.peerCommunityId,
      input.localChannelId,
      input.localChannelName,
      input.home.sharedChannelId,
    ],
  );
  return result.rows.length > 0;
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
    dedicated_to_community_id: string | null;
  }>(
    `
      SELECT
        endpoints.connection_id,
        endpoints.id AS source_endpoint_id,
        endpoints.shared_channel_id,
        endpoints.local_channel_id,
        endpoints.last_event_created_at,
        endpoints.dedicated_to_community_id
      FROM shared_channel_endpoints AS endpoints
      JOIN shared_channels AS channels
        ON channels.id = endpoints.shared_channel_id
      WHERE endpoints.connection_id = ANY($1::uuid[])
        AND endpoints.state = 'active'
        AND endpoints.sends = true
        AND channels.state = 'active'
        AND channels.mode = 'hub'
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
      dedicatedToCommunityId: route.dedicated_to_community_id,
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
    route_state: "active";
    shared_channel_id: string;
    source_actor_pubkey: string;
    source_actor_name: string | null;
    source_community_id: string;
    source_community_name: string;
    source_community_slug: string;
    source_event_id: string;
    source_parent_event_id: string | null;
    source_sends: boolean;
    source_state: SharedChannelEndpointRecord["state"];
    destination_receives: boolean;
    filter_allows: boolean;
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
        messages.source_actor_name,
        messages.source_event_id,
        messages.source_parent_event_id,
        messages.body,
        source_endpoint.community_id AS source_community_id,
        source_endpoint.state AS source_state,
        source_endpoint.sends AS source_sends,
        COALESCE(
          source_community.display_name,
          source_community.slug,
          source_candidate.host
        ) AS source_community_name,
        -- The addressable handle, so a delivered message is tagged with the
        -- same grammar an author types to reply to it.
        COALESCE(source_community.slug, source_candidate.host)
          AS source_community_slug,
        destination_endpoint.id AS destination_endpoint_id,
        destination_endpoint.connection_id AS destination_connection_id,
        destination_endpoint.local_channel_id AS destination_channel_id,
        destination_endpoint.state AS destination_state,
        destination_endpoint.receives AS destination_receives,
        (
          (destination_endpoint.filter_mode = 'everyone_except'
            AND NOT (source_endpoint.community_id = ANY(destination_endpoint.filter_list)))
          OR
          (destination_endpoint.filter_mode = 'only_these'
            AND source_endpoint.community_id = ANY(destination_endpoint.filter_list))
        ) AND (
          (source_endpoint.filter_mode = 'everyone_except'
            AND NOT (destination_endpoint.community_id = ANY(source_endpoint.filter_list)))
          OR
          (source_endpoint.filter_mode = 'only_these'
            AND destination_endpoint.community_id = ANY(source_endpoint.filter_list))
        ) AS filter_allows,
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
      row.destination_state === "active" &&
      row.source_sends &&
      row.destination_receives &&
      row.filter_allows,
    sharedChannelId: row.shared_channel_id,
    sourceActorPubkey: row.source_actor_pubkey,
    sourceActorName: row.source_actor_name,
    sourceCommunityId: row.source_community_id,
    sourceCommunityName: row.source_community_name,
    sourceCommunitySlug: row.source_community_slug,
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
        source_endpoint.sends = true AND
        destination_endpoint.state = 'active' AND
        destination_endpoint.receives = true AND
        (
          (destination_endpoint.filter_mode = 'everyone_except'
            AND NOT (source_endpoint.community_id = ANY(destination_endpoint.filter_list)))
          OR
          (destination_endpoint.filter_mode = 'only_these'
            AND source_endpoint.community_id = ANY(destination_endpoint.filter_list))
        ) AND (
          (source_endpoint.filter_mode = 'everyone_except'
            AND NOT (destination_endpoint.community_id = ANY(source_endpoint.filter_list)))
          OR
          (source_endpoint.filter_mode = 'only_these'
            AND destination_endpoint.community_id = ANY(source_endpoint.filter_list))
        )
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
        AND candidates.state = 'verified_buzz'
      FOR SHARE OF communities
    `,
    [communityId, ownerPubkey],
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
        AND candidates.state = 'verified_buzz'
      FOR SHARE OF communities
    `,
    [communityId],
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

/**
 * A local channel may back only one active hub endpoint per community. Reject a
 * duplicate with a product error instead of surfacing Postgres 23505.
 */
async function assertChannelNotRouted(
  client: PoolClient,
  communityId: string,
  localChannelId: string,
  excludeEndpointId?: string,
): Promise<void> {
  const result = await client.query(
    `
      SELECT 1
      FROM shared_channel_endpoints
      WHERE community_id = $1
        AND local_channel_id = $2
        AND state IN ('active', 'paused')
        AND ($3::uuid IS NULL OR id <> $3)
      LIMIT 1
    `,
    [communityId, localChannelId, excludeEndpointId ?? null],
  );
  if (result.rows.length > 0) {
    throw new ApiError(
      "channel_already_routed",
      "That channel is already connected to the hub. Pick a different channel.",
      409,
    );
  }
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

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError("invalid_input", `${label} is invalid.`);
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

/**
 * Resolve an addressed community handle to a routable participant.
 *
 * Scoped to the shared channel on purpose: a slug that exists in the directory
 * but has not joined the hub, or has switched receiving off, is NOT a valid
 * destination and must read as unknown rather than silently dropping the
 * message into nowhere.
 */
export async function findRoutableCommunityBySlug(
  pool: Pool,
  sharedChannelId: string,
  slug: string,
): Promise<{ communityId: string; slug: string } | null> {
  const result = await pool.query<{ community_id: string; slug: string }>(
    `
      SELECT communities.id AS community_id, communities.slug
      FROM communities
      JOIN shared_channel_endpoints AS endpoints
        ON endpoints.community_id = communities.id
      WHERE lower(communities.slug) = lower($2)
        AND endpoints.shared_channel_id = $1
        AND endpoints.state = 'active'
        AND endpoints.receives = true
      LIMIT 1
    `,
    [sharedChannelId, slug],
  );
  const row = result.rows[0];
  return row ? { communityId: row.community_id, slug: row.slug } : null;
}

export type UndeliverableReason = "unknown-destination" | "unknown-user";

/**
 * Claim the one notice a source event is ever allowed to produce.
 *
 * Returns true exactly once per (source endpoint, source event) across every
 * reader, forever; every later caller gets false and must stay silent.
 *
 * This is required, not defensive. A message that does not route is never
 * ingested, so it never advances `last_event_created_at`, and the connector
 * re-subscribes from that cursor on every idle rebuild — so the relay keeps
 * replaying the same unroutable event. Advancing the cursor would not fix it
 * either: `since` is inclusive (`created_at >= since`), so the event at the
 * cursor is replayed regardless, and moving the cursor past an event we never
 * ingested would skip anything older that had not been read yet. Everything
 * else the connector does with a source event is already idempotent by source
 * event id; the notice needs its own key, and it has to be durable so a restart
 * or a second replica cannot post a second one.
 *
 * Claimed BEFORE publishing, so the failure mode is a missing notice rather
 * than a repeated one.
 */
export async function claimUndeliverableNotice(
  pool: Pool,
  input: {
    reason: UndeliverableReason;
    sourceEndpointId: string;
    sourceEventId: string;
  },
): Promise<boolean> {
  const result = await pool.query<{ source_event_id: string }>(
    `
      INSERT INTO bridge_undeliverable_notices (
        source_endpoint_id,
        source_event_id,
        reason
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (source_endpoint_id, source_event_id) DO NOTHING
      RETURNING source_event_id
    `,
    [input.sourceEndpointId, input.sourceEventId, input.reason],
  );
  return result.rows.length === 1;
}

export type CommandVerb = "open" | "close" | "list" | "usage";

/**
 * Claim the single execution a slash-command source event is ever allowed.
 *
 * Returns true exactly once per (source endpoint, source event) across every
 * reader, forever; every later caller gets false and must do nothing. This is
 * required for the same reason as {@link claimUndeliverableNotice}: an
 * intercepted command is never ingested, so it never advances the endpoint
 * cursor and the relay replays it on every idle rebuild. Claimed BEFORE the
 * command runs, so a replay cannot re-run the handoff or repost the reply.
 */
export async function claimCommandReceipt(
  pool: Pool,
  input: {
    sourceEndpointId: string;
    sourceEventId: string;
    verb: CommandVerb;
  },
): Promise<boolean> {
  const result = await pool.query<{ source_event_id: string }>(
    `
      INSERT INTO bridge_command_receipts (
        source_endpoint_id,
        source_event_id,
        verb
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (source_endpoint_id, source_event_id) DO NOTHING
      RETURNING source_event_id
    `,
    [input.sourceEndpointId, input.sourceEventId, input.verb],
  );
  return result.rows.length === 1;
}

/**
 * Unbind a community's dedicated channel to one peer: turn its sends and
 * receives off so traffic falls back to the inbox, WITHOUT deleting the channel
 * (renaming/deleting needs owner authority the bridge gave up during the
 * handoff, so the channel is left archived). Returns the peer's slug for the
 * confirmation, or null when there is no bound dedicated channel to close.
 */
export async function unbindDedicatedPeerChannel(
  pool: Pool,
  input: { communityId: string; peerCommunityId: string },
): Promise<{ slug: string } | null> {
  const result = await pool.query<{ slug: string | null }>(
    `
      UPDATE shared_channel_endpoints AS endpoints
      SET sends = false, receives = false, updated_at = now()
      FROM communities AS peer
      WHERE endpoints.community_id = $1
        AND endpoints.dedicated_to_community_id = $2
        AND endpoints.state = 'active'
        AND (endpoints.sends = true OR endpoints.receives = true)
        AND peer.id = endpoints.dedicated_to_community_id
      RETURNING peer.slug
    `,
    [input.communityId, input.peerCommunityId],
  );
  const row = result.rows[0];
  return row ? { slug: row.slug ?? input.peerCommunityId } : null;
}

/**
 * Re-enable a community's existing dedicated channel to a peer — the `/open`
 * path when the channel was created earlier and then closed. `attachDedicatedPeerChannel`
 * only inserts (ON CONFLICT DO NOTHING), so without this a re-`/open` would reply
 * "Opened" while the endpoint stayed sends/receives off. Returns true when a row
 * was turned back on, false when there was nothing to re-enable.
 */
export async function reopenDedicatedPeerChannel(
  pool: Pool,
  input: { communityId: string; peerCommunityId: string },
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE shared_channel_endpoints
      SET sends = true, receives = true, updated_at = now()
      WHERE community_id = $1
        AND dedicated_to_community_id = $2
        AND state = 'active'
        AND (sends = false OR receives = false)
      RETURNING id
    `,
    [input.communityId, input.peerCommunityId],
  );
  return result.rows.length > 0;
}

/**
 * The peer communities a community holds an open (not closed) dedicated channel
 * to, as slugs. Used by `/list`.
 */
export async function listDirectChannelPeers(
  pool: Pool,
  communityId: string,
): Promise<string[]> {
  const result = await pool.query<{ slug: string | null; peer_id: string }>(
    `
      SELECT peer.slug, endpoints.dedicated_to_community_id AS peer_id
      FROM shared_channel_endpoints AS endpoints
      JOIN communities AS peer
        ON peer.id = endpoints.dedicated_to_community_id
      WHERE endpoints.community_id = $1
        AND endpoints.dedicated_to_community_id IS NOT NULL
        AND endpoints.state = 'active'
        AND endpoints.receives = true
      ORDER BY peer.slug NULLS LAST, endpoints.dedicated_to_community_id
    `,
    [communityId],
  );
  return result.rows.map((row) => row.slug ?? row.peer_id);
}

/**
 * Peer communities that have sent a message to this community's inbox but that
 * it holds no open dedicated channel to — the candidates for `/open`. Used by
 * `/list`.
 */
export async function listInboundCommunitiesWithoutDirectChannel(
  pool: Pool,
  communityId: string,
): Promise<string[]> {
  const result = await pool.query<{ slug: string | null; peer_id: string }>(
    `
      SELECT DISTINCT source_community.slug,
             source_endpoint.community_id AS peer_id
      FROM bridge_deliveries AS deliveries
      JOIN shared_channel_endpoints AS inbox
        ON inbox.id = deliveries.destination_endpoint_id
      JOIN bridge_messages AS messages
        ON messages.id = deliveries.bridge_message_id
      JOIN shared_channel_endpoints AS source_endpoint
        ON source_endpoint.id = messages.source_endpoint_id
      JOIN communities AS source_community
        ON source_community.id = source_endpoint.community_id
      WHERE inbox.community_id = $1
        AND inbox.dedicated_to_community_id IS NULL
        AND source_endpoint.community_id <> $1
        AND NOT EXISTS (
          SELECT 1
          FROM shared_channel_endpoints AS dedicated
          WHERE dedicated.community_id = $1
            AND dedicated.dedicated_to_community_id
              = source_endpoint.community_id
            AND dedicated.state = 'active'
            AND dedicated.receives = true
        )
      ORDER BY source_community.slug NULLS LAST, peer_id
    `,
    [communityId],
  );
  return result.rows.map((row) => row.slug ?? row.peer_id);
}

/**
 * Give a community an addressable handle if it does not already have one.
 *
 * Addressing is by slug (`@[handle]`), so a hub participant without one cannot
 * be reached at all. Derived from the relay host's first label because that is
 * what an author would guess; a collision gets a numeric suffix rather than
 * stealing a handle another community already answers to.
 */
export async function ensureCommunitySlug(
  client: PoolClient,
  communityId: string,
): Promise<string> {
  const current = await client.query<{ slug: string | null; host: string }>(
    `
      SELECT communities.slug, candidates.host
      FROM communities
      JOIN community_candidates AS candidates
        ON candidates.id = communities.candidate_id
      WHERE communities.id = $1
      FOR UPDATE OF communities
    `,
    [communityId],
  );
  const row = current.rows[0];
  if (!row) throw new ApiError("invalid_input", "Unknown community.", 404);
  if (row.slug && row.slug.trim()) return row.slug;

  const base =
    row.host
      .split(".")[0]!
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "community";
  const stem = base.length >= 2 ? base : `${base}-community`;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? stem : `${stem}-${attempt + 1}`.slice(0, 40);
    const taken = await client.query(
      "SELECT 1 FROM communities WHERE lower(slug) = lower($1) AND id <> $2",
      [candidate, communityId],
    );
    if (taken.rows[0]) continue;
    await client.query(
      "UPDATE communities SET slug = $2, updated_at = now() WHERE id = $1",
      [communityId, candidate],
    );
    return candidate;
  }
  throw new ApiError("invalid_input", "Could not assign a community handle.");
}
