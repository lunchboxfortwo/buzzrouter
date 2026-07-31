import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { Event, EventTemplate, VerifiedEvent } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { finalizeEvent } from "nostr-tools/pure";
import {
  Relay,
  useWebSocketImplementation,
  type Subscription,
} from "nostr-tools/relay";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { WebSocket as NodeWebSocket } from "ws";

import { ApiError } from "../http/api-error";
import { BRIDGE_DELIVERY_QUEUE } from "../jobs/queues";
import {
  canonicalizeSourceEvent,
  createDestinationProjection,
} from "./bridge";
import {
  cancelBridgeDelivery,
  completeBridgeDelivery,
  decryptConnectorPrivateKey,
  getBridgeDeliveryContext,
  ingestBridgeMessage,
  isBridgeDeliveryRouteActive,
  listActiveConnectorConfigs,
  markBridgeDeliveryDelivering,
  markBridgeDeliveryRetry,
  persistDestinationEvent,
  recordConnectionHealth,
  type ActiveConnectorConfig,
  type ConnectorRouteConfig,
} from "./store";

const RECONCILE_INTERVAL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 5_000;
const EVENT_LOOKUP_TIMEOUT_MS = 3_000;
const GROUP_LIST_TIMEOUT_MS = 4_000;
const GROUP_METADATA_KIND = 39_000;
const MAX_WEBSOCKET_MESSAGE_BYTES = 512 * 1_024;
const AUTH_REQUIRED_PATTERN = /auth-required/i;

class ConnectorWebSocket extends NodeWebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols, {
      maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
  }
}

useWebSocketImplementation(ConnectorWebSocket);

export interface WrappingKeyProvider {
  getKey(version: number): Promise<Uint8Array>;
}

export interface RelayGroup {
  id: string;
  name: string;
}

export interface RelayConnection {
  close(): void;
  hasEvent(eventId: string): Promise<boolean>;
  listGroups(): Promise<RelayGroup[]>;
  publish(event: Event): Promise<void>;
  subscribe(
    routes: ConnectorRouteConfig[],
    onEvent: (event: Event) => void,
    onClose: (reason: string) => void,
  ): void;
}

export interface RelayConnectionFactory {
  connect(
    relayUrl: string,
    privateKey: Uint8Array,
  ): Promise<RelayConnection>;
}

interface ConnectorSession {
  config: ActiveConnectorConfig;
  fingerprint: string;
  privateKey: Buffer;
  relay: RelayConnection;
}

interface FailedConnectionAttempt {
  attempts: number;
  nextAttemptAt: number;
}

export interface BridgeDeliveryJob {
  deliveryId: string;
}

export class ConnectorSupervisor {
  private readonly sessions = new Map<string, ConnectorSession>();
  private readonly failures = new Map<string, FailedConnectionAttempt>();
  private reconcileTimer: NodeJS.Timeout | undefined;
  private stopped = true;

  constructor(
    private readonly pool: Pool,
    private readonly boss: PgBoss,
    private readonly wrappingKeys: WrappingKeyProvider,
    private readonly relayFactory: RelayConnectionFactory =
      createRelayConnectionFactory(),
  ) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.reconcile();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch((error) => {
        console.error("Shared-channel connector reconciliation failed", error);
      });
    }, RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = undefined;
    }
    for (const session of this.sessions.values()) {
      closeSession(session);
    }
    this.sessions.clear();
  }

  async reconcile(): Promise<void> {
    if (this.stopped) return;
    const configs = await listActiveConnectorConfigs(this.pool);
    const activeIds = new Set(configs.map((config) => config.id));

    for (const [connectionId, session] of this.sessions) {
      if (!activeIds.has(connectionId)) {
        closeSession(session);
        this.sessions.delete(connectionId);
        this.failures.delete(connectionId);
      }
    }

    for (const config of configs) {
      const fingerprint = connectionFingerprint(config);
      const current = this.sessions.get(config.id);
      if (current?.fingerprint === fingerprint) continue;
      if (current) {
        closeSession(current);
        this.sessions.delete(config.id);
      }

      const failed = this.failures.get(config.id);
      if (failed && failed.nextAttemptAt > Date.now()) continue;
      await this.startConnection(config, fingerprint);
    }
  }

  async deliver(
    deliveryId: string,
    terminalAttempt = false,
  ): Promise<void> {
    const context = await getBridgeDeliveryContext(this.pool, deliveryId);
    if (
      !context ||
      context.state === "delivered_to_relay" ||
      context.state === "cancelled" ||
      context.state === "failed"
    ) {
      return;
    }
    if (!context.routeActive) {
      await cancelBridgeDelivery(this.pool, deliveryId);
      return;
    }
    if (
      context.sourceParentEventId &&
      !context.localParentEventId
    ) {
      await markBridgeDeliveryRetry(
        this.pool,
        deliveryId,
        "parent_mapping_missing",
        terminalAttempt,
      );
      if (terminalAttempt) return;
      throw new ApiError(
        "parent_mapping_missing",
        "The destination parent mapping is not available.",
        409,
      );
    }

    const session = this.sessions.get(context.destinationConnectionId);
    if (!session) {
      await markBridgeDeliveryRetry(
        this.pool,
        deliveryId,
        "connector_unavailable",
        terminalAttempt,
      );
      if (terminalAttempt) return;
      throw new ApiError(
        "connector_unavailable",
        "The destination connector is unavailable.",
        503,
      );
    }
    if (!(await markBridgeDeliveryDelivering(this.pool, deliveryId))) {
      return;
    }

    const projection =
      context.destinationEvent ??
      createDestinationProjection(
        {
          body: context.body,
          destinationChannelId: context.destinationChannelId,
          localParentEventId: context.localParentEventId ?? undefined,
          messageId: context.messageId,
          sourceActorPubkey: context.sourceActorPubkey,
          sourceCommunityId: context.sourceCommunityId,
          sourceCommunityName: context.sourceCommunityName,
          sourceEventId: context.sourceEventId,
        },
        session.privateKey,
      );
    const event = await persistDestinationEvent(
      this.pool,
      deliveryId,
      projection,
    );
    if (!(await isBridgeDeliveryRouteActive(this.pool, deliveryId))) {
      await cancelBridgeDelivery(this.pool, deliveryId);
      return;
    }

    try {
      await session.relay.publish(event);
    } catch (error) {
      const exists = await session.relay.hasEvent(event.id).catch(
        () => false,
      );
      if (!exists) {
        await markBridgeDeliveryRetry(
          this.pool,
          deliveryId,
          deliveryErrorCode(error),
          terminalAttempt,
        );
        if (terminalAttempt) return;
        throw error;
      }
    }

    await completeBridgeDelivery(this.pool, deliveryId, event);
  }

  private async startConnection(
    config: ActiveConnectorConfig,
    fingerprint: string,
  ): Promise<void> {
    let privateKey: Buffer | undefined;
    let relay: RelayConnection | undefined;
    try {
      const wrappingKey = await this.wrappingKeys.getKey(
        config.wrappingKeyVersion,
      );
      privateKey = decryptConnectorPrivateKey(
        config,
        wrappingKey,
        config.communityId,
      );
      relay = await this.relayFactory.connect(
        config.relayUrl,
        privateKey,
      );
      const session: ConnectorSession = {
        config,
        fingerprint,
        privateKey,
        relay,
      };
      this.sessions.set(config.id, session);
      this.failures.delete(config.id);
      relay.subscribe(
        config.routes,
        (event) => {
          void this.handleSourceEvent(session, event);
        },
        (reason) => {
          void recordConnectionHealth(
            this.pool,
            config.id,
            "degraded",
            reason,
          );
        },
      );
      await recordConnectionHealth(this.pool, config.id, "healthy");
    } catch (error) {
      relay?.close();
      this.sessions.delete(config.id);
      privateKey?.fill(0);
      const previous = this.failures.get(config.id)?.attempts ?? 0;
      const attempts = previous + 1;
      const delayMs = Math.min(
        15 * 60_000,
        15_000 * 2 ** Math.min(attempts - 1, 6),
      );
      this.failures.set(config.id, {
        attempts,
        nextAttemptAt: Date.now() + delayMs,
      });
      await recordConnectionHealth(
        this.pool,
        config.id,
        connectionHealthForError(error),
        safeErrorMessage(error),
      );
    }
  }

  private async handleSourceEvent(
    session: ConnectorSession,
    event: Event,
  ): Promise<void> {
    const channelId = event.tags.find((tag) => tag[0] === "h")?.[1];
    const route = session.config.routes.find(
      (candidate) => candidate.localChannelId === channelId,
    );
    if (!route) return;

    try {
      const canonical = canonicalizeSourceEvent(event, {
        bridgePubkey: session.config.bridgePubkey,
        localChannelId: route.localChannelId,
        sharedChannelId: route.sharedChannelId,
        sourceEndpointId: route.sourceEndpointId,
      });
      if (!canonical) return;
      await ingestBridgeMessage(this.pool, this.boss, {
        ...canonical,
        messageId: randomUUID(),
      });
      await recordConnectionHealth(
        this.pool,
        session.config.id,
        "healthy",
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        (
          error.code.startsWith("source_") ||
          error.code === "route_inactive"
        )
      ) {
        console.warn(
          `Ignored invalid shared-channel event: ${error.code}`,
        );
        return;
      }
      await recordConnectionHealth(
        this.pool,
        session.config.id,
        "degraded",
        safeErrorMessage(error),
      );
      console.error("Shared-channel event ingestion failed", error);
    }
  }
}

export async function registerBridgeDeliveryWorker(
  boss: PgBoss,
  supervisor: ConnectorSupervisor,
): Promise<void> {
  await boss.work<BridgeDeliveryJob>(
    BRIDGE_DELIVERY_QUEUE,
    {
      batchSize: 1,
      includeMetadata: true,
      localConcurrency: 10,
    },
    async (jobs) => {
      for (const job of jobs as JobWithMetadata<BridgeDeliveryJob>[]) {
        await supervisor.deliver(
          job.data.deliveryId,
          job.retryCount >= job.retryLimit,
        );
      }
    },
  );
}

export function createFileWrappingKeyProvider(
  filePath =
    process.env.BUZZROUTER_CONNECTOR_WRAPPING_KEYS_FILE,
): WrappingKeyProvider {
  let keys: Map<number, Buffer> | undefined;

  return {
    async getKey(version) {
      if (!keys) {
        if (!filePath) {
          throw new ApiError(
            "wrapping_key_unconfigured",
            "Connector wrapping keys are not configured.",
            500,
          );
        }
        keys = parseWrappingKeyFile(await readFile(filePath, "utf8"));
      }
      const key = keys.get(version);
      if (!key) {
        throw new ApiError(
          "wrapping_key_unavailable",
          "The connector wrapping key version is unavailable.",
          500,
        );
      }
      return key;
    },
  };
}

export function parseWrappingKeyFile(contents: string): Map<number, Buffer> {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new ApiError(
      "wrapping_key_file_invalid",
      "The connector wrapping-key file is invalid.",
      500,
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ApiError(
      "wrapping_key_file_invalid",
      "The connector wrapping-key file is invalid.",
      500,
    );
  }

  const keys = new Map<number, Buffer>();
  for (const [versionText, encoded] of Object.entries(value)) {
    const version = Number(versionText);
    if (
      !Number.isInteger(version) ||
      version < 1 ||
      typeof encoded !== "string"
    ) {
      throw new ApiError(
        "wrapping_key_file_invalid",
        "The connector wrapping-key file is invalid.",
        500,
      );
    }
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== 32) {
      throw new ApiError(
        "wrapping_key_file_invalid",
        "Connector wrapping keys must be 32 bytes.",
        500,
      );
    }
    keys.set(version, key);
  }
  if (keys.size === 0) {
    throw new ApiError(
      "wrapping_key_file_invalid",
      "The connector wrapping-key file is empty.",
      500,
    );
  }
  return keys;
}

export function createRelayConnectionFactory(): RelayConnectionFactory {
  return {
    async connect(relayUrl, privateKey) {
      const relay = new Relay(relayUrl, {
        enablePing: true,
        enableReconnect: true,
        idleTimeout: 0,
      });
      relay.onauth = async (template: EventTemplate) =>
        finalizeEvent(template, privateKey) as VerifiedEvent;
      await relay.connect({ timeout: CONNECT_TIMEOUT_MS });
      const connection = new NostrRelayConnection(relay, privateKey);
      await connection.authenticate();
      return connection;
    },
  };
}

/**
 * Buzz relays reject publishes and subscriptions until the session completes
 * NIP-42. Setting `onauth` alone does not authenticate — nostr-tools only
 * signs when `auth()` is called — so authenticate eagerly, and retry once if
 * the challenge lands after connect.
 */
function isAuthRequired(error: unknown): boolean {
  return (
    error instanceof Error && AUTH_REQUIRED_PATTERN.test(error.message)
  );
}

function isMissingChallenge(error: unknown): boolean {
  return error instanceof Error && /no challenge/i.test(error.message);
}

export class NostrRelayConnection implements RelayConnection {
  private subscription: Subscription | undefined;

  constructor(
    private readonly relay: Relay,
    private readonly privateKey: Uint8Array,
  ) {}

  /**
   * Best effort: relays that never send a challenge do not need NIP-42, and
   * `auth()` reports that by throwing rather than hanging.
   */
  async authenticate(): Promise<void> {
    try {
      await this.relay.auth(
        async (template: EventTemplate) =>
          finalizeEvent(template, this.privateKey) as VerifiedEvent,
      );
    } catch (error) {
      if (isMissingChallenge(error)) return;
      throw error;
    }
  }

  close(): void {
    this.subscription?.close("connector stopped");
    this.subscription = undefined;
    this.relay.close();
  }

  /**
   * Enumerate the relay's NIP-29 groups (its channels) from their kind-39000
   * metadata. Mirrors {@link publish}: authenticate eagerly, and if a REQ is
   * rejected because the challenge only arrives after connect, re-authenticate
   * and retry once.
   */
  async listGroups(): Promise<RelayGroup[]> {
    try {
      return await this.collectGroups();
    } catch (error) {
      if (!isAuthRequired(error)) throw error;
      await this.authenticate();
      return await this.collectGroups();
    }
  }

  private collectGroups(): Promise<RelayGroup[]> {
    return new Promise((resolve, reject) => {
      const groups = new Map<string, RelayGroup>();
      let settled = false;
      let subscription: Subscription | undefined;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        subscription?.close("group listing complete");
        complete();
      };
      const timeout = setTimeout(
        () => finish(() => resolve([...groups.values()])),
        GROUP_LIST_TIMEOUT_MS,
      );
      subscription = this.relay.subscribe(
        [{ kinds: [GROUP_METADATA_KIND] }],
        {
          onclose: (reason: string) =>
            finish(() =>
              AUTH_REQUIRED_PATTERN.test(reason)
                ? reject(new Error(reason))
                : resolve([...groups.values()]),
            ),
          oneose: () => finish(() => resolve([...groups.values()])),
          onevent: (event: Event) => {
            const group = toRelayGroup(event);
            if (group) groups.set(group.id, group);
          },
        },
      );
    });
  }

  async hasEvent(eventId: string): Promise<boolean> {
    if (!this.relay.connected) return false;

    return new Promise((resolve) => {
      let settled = false;
      let subscription: Subscription | undefined;
      const finish = (found: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        subscription?.close("event lookup complete");
        resolve(found);
      };
      const timeout = setTimeout(
        () => finish(false),
        EVENT_LOOKUP_TIMEOUT_MS,
      );
      subscription = this.relay.subscribe(
        [{ ids: [eventId], limit: 1 }],
        {
          oneose: () => finish(false),
          onevent: () => finish(true),
          onclose: () => finish(false),
        },
      );
    });
  }

  async publish(event: Event): Promise<void> {
    try {
      await this.relay.publish(event);
    } catch (error) {
      if (!isAuthRequired(error)) throw error;
      await this.authenticate();
      await this.relay.publish(event);
    }
  }

  subscribe(
    routes: ConnectorRouteConfig[],
    onEvent: (event: Event) => void,
    onClose: (reason: string) => void,
  ): void {
    this.subscription?.close("routes changed");
    if (routes.length === 0) {
      this.subscription = undefined;
      return;
    }

    const filter: Filter = {
      "#h": [...new Set(routes.map((route) => route.localChannelId))],
      kinds: [9],
      since: Math.min(
        ...routes.map((route) => route.lastEventCreatedAt),
      ),
    };
    this.subscription = this.relay.subscribe([filter], {
      onevent: onEvent,
      onclose: onClose,
    });
  }
}

function toRelayGroup(event: Event): RelayGroup | null {
  const id = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (!id) return null;
  const name = event.tags.find((tag) => tag[0] === "name")?.[1];
  return {
    id,
    name: name && name.trim().length > 0 ? name.trim() : id,
  };
}

function parseErrorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return "relay_publish_failed";
}

function deliveryErrorCode(error: unknown): string {
  return parseErrorCode(error).slice(0, 80);
}

function connectionHealthForError(
  error: unknown,
): "credential_error" | "unauthorized" | "unreachable" {
  if (
    error instanceof ApiError &&
    error.code.startsWith("wrapping_key")
  ) {
    return "credential_error";
  }
  const message = safeErrorMessage(error).toLowerCase();
  if (message.includes("auth") || message.includes("permission")) {
    return "unauthorized";
  }
  return "unreachable";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (error instanceof Error) return error.name;
  return "unknown_error";
}

function connectionFingerprint(config: ActiveConnectorConfig): string {
  return JSON.stringify({
    bridgePubkey: config.bridgePubkey,
    relayUrl: config.relayUrl,
    routes: config.routes.map((route) => ({
      channel: route.localChannelId,
      endpoint: route.sourceEndpointId,
      sharedChannel: route.sharedChannelId,
    })),
    wrappingKeyVersion: config.wrappingKeyVersion,
  });
}

function closeSession(session: ConnectorSession): void {
  session.relay.close();
  session.privateKey.fill(0);
}
