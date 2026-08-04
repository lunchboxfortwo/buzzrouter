import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { Event, EventTemplate, VerifiedEvent } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";
import {
  Relay,
  useWebSocketImplementation,
  type Subscription,
} from "nostr-tools/relay";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Pool, PoolClient } from "pg";
import { WebSocket as NodeWebSocket } from "ws";

import { ApiError } from "../http/api-error";
import { BRIDGE_DELIVERY_QUEUE } from "../jobs/queues";
import {
  BUZZ_MESSAGE_KIND,
  canonicalizeSourceEvent,
  createDestinationProjection,
} from "./bridge";
import {
  cancelBridgeDelivery,
  completeBridgeDelivery,
  decryptConnectorPrivateKey,
  findRoutableCommunityBySlug,
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
  homeCommunityChannelId,
  homeCommunityRelayUrl,
} from "./store";

const RECONCILE_INTERVAL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 5_000;
const EVENT_LOOKUP_TIMEOUT_MS = 3_000;
const GROUP_LIST_TIMEOUT_MS = 4_000;
const RELAY_STATE_TIMEOUT_MS = 4_000;
const RELAY_INFO_TIMEOUT_MS = 4_000;
const AUTH_SETTLE_TIMEOUT_MS = 5_000;
const GROUP_METADATA_KIND = 39_000;
const GROUP_MEMBERS_KIND = 39_002;
const COMMUNITY_ROSTER_KIND = 13_534;
const PUT_USER_KIND = 9_000;
const MAX_WEBSOCKET_MESSAGE_BYTES = 512 * 1_024;
/**
 * How long a session may receive nothing before its subscription is rebuilt.
 *
 * A backstop, not the delivery path — live fan-out routes messages (see
 * {@link NostrRelayConnection.subscribe} for why the channel and roster
 * filters must stay separate for that to work). So this only has to catch a
 * subscription that has silently stopped delivering, and is sized to be cheap
 * rather than to bound routing latency: at worst one reconnect per idle
 * minute per community.
 */
const RELAY_IDLE_RECYCLE_AFTER_MS = 60_000;
const AUTH_REQUIRED_PATTERN = /auth-required/i;
/**
 * How long a destination community's member-name index may be reused.
 *
 * Checking `@community/user` needs a name, and the relay only stores pubkeys
 * (the roster) and profiles (kind 0) — so there is no single query that answers
 * "is anyone here called bob", and a correct check costs a roster read plus a
 * profile read per member. The index makes that affordable: profile names are
 * cached for the life of the connection by {@link
 * NostrRelayConnection.getProfileName}, so a rebuild is one roster REQ plus a
 * profile REQ for members seen for the first time. A few seconds is short
 * enough that someone who has just joined is addressable almost immediately,
 * and long enough that a burst of messages costs one read rather than one each.
 */
const MEMBER_NAME_CACHE_MS = 5_000;
/** Profile reads per wave, so a large roster cannot open one REQ per member. */
const PROFILE_LOOKUP_BATCH = 8;
/**
 * How long an index may take to build before the community is left unchecked.
 *
 * Validation must never become an outage: a roster too large or too slow to
 * index in this budget delivers unvalidated, exactly as it did before there was
 * a check, rather than holding the message while every member is resolved.
 */
const MEMBER_INDEX_TIMEOUT_MS = 4_000;

/**
 * A relay socket carrying the connector's transport limits.
 *
 * Liveness is nostr-tools' job: with `enablePing` its `pingpong()` pings on an
 * interval and closes a socket that misses a pong, which reaches the
 * supervisor as the subscription `onclose` its recovery path already handles.
 */
export class ConnectorWebSocket extends NodeWebSocket {
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

export type CommunityRoster = Map<string, string>;

export interface RelayConnection {
  close(): void;
  hasEvent(eventId: string): Promise<boolean>;
  listGroups(): Promise<RelayGroup[]>;
  readGroupMembers(groupId: string): Promise<Set<string> | null>;
  readRoster(): Promise<Set<string> | null>;
  readRosterRoles(): Promise<CommunityRoster | null>;
  getProfileName?(pubkey: string): Promise<string | null>;
  publish(event: Event): Promise<void>;
  subscribe(
    routes: ConnectorRouteConfig[],
    watchCommunityRoster: boolean,
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
  /** Last time anything at all arrived on this connection. */
  lastInboundAt: number;
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
  private readonly membershipReconciliations = new Map<string, Promise<void>>();
  /**
   * Per connection: the addressable member names of its community, or `null`
   * for "no usable index right now", which never bounces.
   */
  private readonly memberNames = new Map<
    string,
    { expiresAt: number; names: Set<string> | null }
  >();
  private readonly memberNameBuilds = new Map<
    string,
    Promise<Set<string> | null>
  >();
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
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) {
      closeSession(session);
    }
    await Promise.allSettled(this.membershipReconciliations.values());
  }

  async reconcile(): Promise<void> {
    if (this.stopped) return;
    const configs = await listActiveConnectorConfigs(this.pool);
    const activeIds = new Set(configs.map((config) => config.id));

    for (const [connectionId, session] of this.sessions) {
      if (!activeIds.has(connectionId)) {
        this.sessions.delete(connectionId);
        closeSession(session);
        this.failures.delete(connectionId);
        this.memberNames.delete(connectionId);
      }
    }

    for (const config of configs) {
      const fingerprint = connectionFingerprint(config);
      const current = this.sessions.get(config.id);
      if (current?.fingerprint === fingerprint) {
        if (!this.isStale(current)) {
          this.scheduleHomeMembershipReconciliation(current);
          continue;
        }
        console.log(
          `connector: rebuilding idle session relay=${config.relayUrl} ` +
            `silentFor=${Math.round((Date.now() - current.lastInboundAt) / 1000)}s`,
        );
        // Fall through and rebuild, rather than leave a session in place that
        // keeps reporting healthy while receiving nothing.
        this.sessions.delete(config.id);
        closeSession(current);
        // Not an error: a scheduled refresh of a subscription we cannot
        // otherwise trust. Health is restored by startConnection below.
      } else if (current) {
        this.sessions.delete(config.id);
        closeSession(current);
      }

      const failed = this.failures.get(config.id);
      if (failed && failed.nextAttemptAt > Date.now()) continue;
      await this.startConnection(config, fingerprint);
    }
  }

  /**
   * True when a session has been silent long enough that it must be rebuilt.
   *
   * A subscription that has stopped delivering looks exactly like a quiet
   * channel from this side — the socket is OPEN either way — so silence is the
   * only signal available. Recycling on it cannot be silently wrong: the worst
   * case is one wasted reconnect for a community that simply had nothing to
   * say.
   */
  private isStale(session: ConnectorSession): boolean {
    return Date.now() - session.lastInboundAt >= RELAY_IDLE_RECYCLE_AFTER_MS;
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
          sourceActorName: context.sourceActorName,
          sourceCommunityId: context.sourceCommunityId,
          sourceCommunitySlug: context.sourceCommunitySlug,
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
        lastInboundAt: Date.now(),
      };
      this.sessions.set(config.id, session);
      this.failures.delete(config.id);
      relay.subscribe(
        config.routes,
        isOperatedCommunityRelay(config.relayUrl),
        (event) => {
          session.lastInboundAt = Date.now();
          if (event.kind === COMMUNITY_ROSTER_KIND) {
            this.scheduleHomeMembershipReconciliation(session);
          } else {
            void this.handleSourceEvent(session, event);
          }
        },
        (reason) => {
          console.log(
            `connector: subscription closed relay=${config.relayUrl} reason=${reason}`,
          );
          if (this.sessions.get(config.id) === session) {
            this.sessions.delete(config.id);
            closeSession(session);
            void recordConnectionHealth(
              this.pool,
              config.id,
              "degraded",
              reason,
            );
          }
        },
      );
      if (this.sessions.get(config.id) !== session) return;
      console.log(`connector: session established relay=${config.relayUrl}`);
      this.scheduleHomeMembershipReconciliation(session);
      await recordConnectionHealth(this.pool, config.id, "healthy");
    } catch (error) {
      this.sessions.delete(config.id);
      relay?.close();
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

  private scheduleHomeMembershipReconciliation(
    session: ConnectorSession,
  ): void {
    if (!isOperatedCommunityRelay(session.config.relayUrl)) return;

    const previous =
      this.membershipReconciliations.get(session.config.id) ??
      Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.sessions.get(session.config.id) !== session) return;
        const privateKey = Buffer.from(session.privateKey);
        let client: PoolClient | undefined;
        let lockAcquired = false;
        try {
          client = await this.pool.connect();
          const lock = await client.query<{ acquired: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
            [`home-membership:${session.config.id}:${homeCommunityChannelId()}`],
          );
          lockAcquired = lock.rows[0]?.acquired === true;
          if (!lockAcquired) return;
          if (this.sessions.get(session.config.id) !== session) return;
          const added = await reconcileHomeCommunityMembers(
            session.relay,
            privateKey,
            () =>
              !this.stopped &&
              this.sessions.get(session.config.id) === session,
          );
          if (added === null) {
            throw new ApiError(
              "home_roster_unreadable",
              "The operated community roster could not be verified.",
              503,
            );
          }
        } finally {
          if (client && lockAcquired) {
            await client
              .query(
                "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
                [`home-membership:${session.config.id}:${homeCommunityChannelId()}`],
              )
              .catch(() => undefined);
          }
          client?.release();
          privateKey.fill(0);
        }
      })
      .catch(async (error) => {
        if (!this.stopped && this.sessions.get(session.config.id) === session) {
          await recordConnectionHealth(
            this.pool,
            session.config.id,
            "degraded",
            safeErrorMessage(error),
          );
          console.error("Home-community channel reconciliation failed", error);
        }
      })
      .finally(() => {
        if (this.membershipReconciliations.get(session.config.id) === next) {
          this.membershipReconciliations.delete(session.config.id);
        }
      });
    this.membershipReconciliations.set(session.config.id, next);
  }

  /**
   * Tell the sender, in their own channel, that nothing was delivered.
   *
   * Deliberately not a bridge_deliveries row: nothing was routed, so there is
   * no delivery to retry or report on. Failure to post the notice is swallowed
   * — a bounce that throws would mark an otherwise healthy connection degraded.
   *
   * The notice cannot start a loop. It is signed with the bridge's own key, and
   * {@link canonicalizeSourceEvent} drops anything the bridge authored before
   * it looks at the content at all; the `br notice` tag is not a projection
   * marker, so that check is the one doing the work. As a second stop the text
   * opens with `BuzzRouter:` rather than an `@`, so even a notice read by some
   * other connector parses as unaddressed chat and routes nowhere.
   */
  private async reportUndeliverable(
    session: ConnectorSession,
    localChannelId: string,
    slug: string,
    user?: string,
  ): Promise<void> {
    try {
      await session.relay.publish(
        finalizeEvent(
          {
            content: undeliverableNotice(slug, user),
            created_at: Math.floor(Date.now() / 1_000),
            kind: BUZZ_MESSAGE_KIND,
            tags: [
              ["h", localChannelId],
              [
                "br",
                "notice",
                user === undefined ? "unknown-destination" : "unknown-user",
              ],
            ],
          },
          session.privateKey,
        ),
      );
    } catch {
      // Best effort only.
    }
  }

  /**
   * Whether the destination community has a member the author could have meant.
   *
   * `null` is "cannot tell" — this process holds no live session for that
   * community, or its roster did not read — and MUST NOT bounce: refusing a
   * message because our own connection is unhealthy would be a worse lie than
   * the mention that fails to resolve.
   */
  private async destinationHasMember(
    communityId: string,
    user: string,
  ): Promise<boolean | null> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.config.communityId === communityId,
    );
    if (!session?.relay.getProfileName) return null;
    try {
      const names = await this.communityMemberNames(session);
      return names?.has(user.toLowerCase()) ?? null;
    } catch {
      // A failure to check says nothing about the roster, and it is the far
      // end's relay that failed: never bounce on it, never degrade this side.
      return null;
    }
  }

  private communityMemberNames(
    session: ConnectorSession,
  ): Promise<Set<string> | null> {
    const cached = this.memberNames.get(session.config.id);
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.names);
    }
    // One build at a time per community. Without this a burst of addressed
    // messages would each start their own roster read, which is the relay
    // hammering this cache exists to prevent.
    const running = this.memberNameBuilds.get(session.config.id);
    if (running) return running;

    const build = this.buildMemberNames(session).finally(() => {
      this.memberNameBuilds.delete(session.config.id);
    });
    this.memberNameBuilds.set(session.config.id, build);
    return build;
  }

  private async buildMemberNames(
    session: ConnectorSession,
  ): Promise<Set<string> | null> {
    // The roster is relay-signed, so membership is the relay's answer rather
    // than ours; only the pubkey-to-name step is a guess, and it is the same
    // guess a human reading `@bob` in that channel makes.
    const roster = await session.relay.readRosterRoles();
    if (!roster) {
      // Cached as "unusable" so an unreadable roster costs one read per window
      // rather than one per message.
      this.rememberMemberNames(session, null);
      return null;
    }
    const names = new Set<string>();
    const pubkeys = [...roster.keys()];
    const deadline = Date.now() + MEMBER_INDEX_TIMEOUT_MS;
    for (let index = 0; index < pubkeys.length; index += PROFILE_LOOKUP_BATCH) {
      // A half-built index would bounce members it simply had not reached yet,
      // so a build that runs long is abandoned whole. Nothing is lost: profile
      // names stay cached on the connection, so the next attempt starts from
      // where this one got to and a large community converges.
      if (Date.now() > deadline) {
        this.rememberMemberNames(session, null);
        return null;
      }
      const batch = pubkeys.slice(index, index + PROFILE_LOOKUP_BATCH);
      const resolved = await Promise.all(
        batch.map((pubkey) => session.relay.getProfileName!(pubkey)),
      );
      batch.forEach((pubkey, offset) => {
        // A pubkey is a name a person can type, and one we can be certain of.
        names.add(pubkey.toLowerCase());
        const profile = resolved[offset];
        if (profile) names.add(profile.trim().toLowerCase());
      });
    }
    this.rememberMemberNames(session, names);
    return names;
  }

  /** Cache the index, or the fact that there is currently no usable one. */
  private rememberMemberNames(
    session: ConnectorSession,
    names: Set<string> | null,
  ): void {
    this.memberNames.set(session.config.id, {
      expiresAt: Date.now() + MEMBER_NAME_CACHE_MS,
      names,
    });
  }

  private async handleSourceEvent(
    session: ConnectorSession,
    event: Event,
  ): Promise<void> {
    const channelId = event.tags.find((tag) => tag[0] === "h")?.[1];
    if (!channelId) return;

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

      const destination = await findRoutableCommunityBySlug(
        this.pool,
        canonical.sharedChannelId,
        canonical.destinationSlug,
      );
      if (!destination) {
        // Every parse reaching here is in the addressing position — the first
        // token of the message — so it is routing intent whether or not it was
        // bracketed. Staying silent is what made a typo look like a send.
        await this.reportUndeliverable(
          session,
          route.localChannelId,
          canonical.destinationSlug,
        );
        return;
      }

      if (canonical.destinationUser !== undefined) {
        const addressable = await this.destinationHasMember(
          destination.communityId,
          canonical.destinationUser,
        );
        // Delivering anyway would mention nobody at the far end, which is the
        // failure this bounce exists to surface. `null` is not a failure.
        if (addressable === false) {
          await this.reportUndeliverable(
            session,
            route.localChannelId,
            destination.slug,
            canonical.destinationUser,
          );
          return;
        }
      }

      const sourceActorName = await session.relay.getProfileName?.(event.pubkey);
      await ingestBridgeMessage(this.pool, this.boss, {
        ...canonical,
        destinationCommunityId: destination.communityId,
        messageId: randomUUID(),
        sourceActorName: sourceActorName ?? undefined,
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

/**
 * The text of a bounce, in the grammar the author already reads.
 *
 * A delivered message is tagged `@community/user`, so the notice quotes the
 * address back in that same form and then names the half that failed — a
 * message that mentions the wrong community and one that mentions nobody are
 * different mistakes with different fixes, and the older notice could only
 * describe the first.
 */
export function undeliverableNotice(slug: string, user?: string): string {
  const address = user === undefined ? `@${slug}` : `@${slug}/${user}`;
  const cause =
    user === undefined
      ? "no connected community has that name"
      : `@${slug} is connected, but nobody there is named ${user}`;
  return `BuzzRouter: not delivered to ${address} — ${cause}.`;
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
      // enableReconnect stays OFF so that reconnection is the supervisor's.
      // In nostr-tools' relay.js, `handleHardClose` takes the reconnect branch
      // INSTEAD of calling `onclose` and `closeAllSubscriptions(reason)`: with
      // it on, a dropped socket never reaches the subscription `onclose` this
      // connector uses to tear the session down and record it degraded, and
      // the reopened socket re-fires the open subscriptions from `ws.onopen`
      // itself, so recovery would bypass this factory entirely.
      //
      // With it off the drop surfaces as `onclose`, the supervisor rebuilds
      // through here, and connect -> authenticate -> subscribe stays ordered.
      const relay = new Relay(relayUrl, {
        enablePing: true,
        enableReconnect: false,
        idleTimeout: 0,
      });
      relay.onauth = async (template: EventTemplate) =>
        finalizeEvent(template, privateKey) as VerifiedEvent;
      await relay.connect({ timeout: CONNECT_TIMEOUT_MS });
      const connection = new NostrRelayConnection(relay, privateKey, relayUrl);
      await connection.authenticate();
      return connection;
    },
  };
}

/**
 * Buzz relays reject publishes and subscriptions until the session completes
 * NIP-42. Setting `onauth` alone does not authenticate — nostr-tools only
 * signs when `auth()` is called — so {@link NostrRelayConnection.authenticate}
 * waits for the challenge and completes auth before connect returns.
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
  private subscriptions: Subscription[] = [];
  private readonly profileNames = new Map<string, string | null>();
  private relayIdentity: string | undefined;

  constructor(
    private readonly relay: Relay,
    private readonly privateKey: Uint8Array,
    private readonly relayUrl?: string,
  ) {}

  /**
   * Returns only once the connection is actually authenticated. The relay's
   * AUTH challenge often arrives just after connect, so a single `auth()`
   * call can land first and throw "no challenge" for a relay that DOES
   * require auth; swallowing that (as this used to) returns an
   * unauthenticated connection whose first REQ then races the challenge and
   * comes back empty. Retry until the challenge lands and auth completes,
   * and give up quietly only after the deadline — a relay that never
   * challenges genuinely needs no auth.
   */
  async authenticate(): Promise<void> {
    const deadline = Date.now() + AUTH_SETTLE_TIMEOUT_MS;
    for (;;) {
      try {
        await this.relay.auth(
          async (template: EventTemplate) =>
            finalizeEvent(template, this.privateKey) as VerifiedEvent,
        );
        return;
      } catch (error) {
        if (isMissingChallenge(error)) {
          if (Date.now() >= deadline) return;
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        throw error;
      }
    }
  }

  close(): void {
    this.closeSubscriptions("connector stopped");
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

  async readRoster(): Promise<Set<string> | null> {
    return this.readRelayState({ kinds: [COMMUNITY_ROSTER_KIND] }, (event) =>
      parseMemberPubkeys(event, "member"),
    );
  }

  async readRosterRoles(): Promise<CommunityRoster | null> {
    return this.readRelayState({ kinds: [COMMUNITY_ROSTER_KIND] }, (event) =>
      parseRosterRoles(event),
    );
  }

  async readGroupMembers(groupId: string): Promise<Set<string> | null> {
    return this.readRelayState(
      {
        "#d": [groupId],
        kinds: [GROUP_MEMBERS_KIND],
      },
      (event) =>
        event.tags.some((tag) => tag[0] === "d" && tag[1] === groupId)
          ? parseMemberPubkeys(event, "p")
          : null,
    );
  }

  private async readRelayState<T>(
    filter: Filter,
    parse: (event: Event) => T | null,
  ): Promise<T | null> {
    let relayIdentity: string;
    try {
      relayIdentity = await this.getRelayIdentity();
    } catch {
      return null;
    }
    const verifiedFilter = { ...filter, authors: [relayIdentity] };
    try {
      return await this.collectRelayState(verifiedFilter, relayIdentity, parse);
    } catch (error) {
      if (!isAuthRequired(error)) return null;
      try {
        await this.authenticate();
        return await this.collectRelayState(
          verifiedFilter,
          relayIdentity,
          parse,
        );
      } catch {
        return null;
      }
    }
  }

  private collectRelayState<T>(
    filter: Filter,
    relayIdentity: string,
    parse: (event: Event) => T | null,
  ): Promise<T | null> {
    return new Promise((resolve, reject) => {
      let latest: Event | undefined;
      let settled = false;
      let subscription: Subscription | undefined;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        subscription?.close("relay state read complete");
        complete();
      };
      const done = () => {
        if (
          !latest ||
          (filter.kinds?.length === 1 && latest.kind !== filter.kinds[0]) ||
          latest.pubkey !== relayIdentity ||
          !verifyEvent(latest)
        ) {
          resolve(null);
          return;
        }
        resolve(parse(latest));
      };
      const timeout = setTimeout(
        () => finish(() => resolve(null)),
        RELAY_STATE_TIMEOUT_MS,
      );
      subscription = this.relay.subscribe([filter], {
        onclose: (reason: string) =>
          finish(() =>
            AUTH_REQUIRED_PATTERN.test(reason)
              ? reject(new Error(reason))
              : resolve(null),
          ),
        oneose: () => finish(done),
        onevent: (event: Event) => {
          if (!latest || event.created_at > latest.created_at) latest = event;
        },
      });
    });
  }

  private async getRelayIdentity(): Promise<string> {
    if (this.relayIdentity) return this.relayIdentity;
    if (!this.relayUrl) throw new Error("relay URL unavailable");
    const url = new URL(this.relayUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    const response = await fetch(url, {
      headers: { Accept: "application/nostr+json" },
      redirect: "error",
      signal: AbortSignal.timeout(RELAY_INFO_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("relay information unavailable");
    const value = (await response.json()) as { self?: unknown };
    if (
      typeof value.self !== "string" ||
      !/^[a-f0-9]{64}$/i.test(value.self)
    ) {
      throw new Error("relay identity unavailable");
    }
    this.relayIdentity = value.self.toLowerCase();
    return this.relayIdentity;
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

  async getProfileName(pubkey: string): Promise<string | null> {
    if (this.profileNames.has(pubkey)) {
      return this.profileNames.get(pubkey) ?? null;
    }
    const name = await new Promise<string | null>((resolve) => {
      let latest: Event | undefined;
      let settled = false;
      let subscription: Subscription | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        subscription?.close("profile lookup complete");
        resolve(profileDisplayName(latest));
      };
      const timeout = setTimeout(finish, EVENT_LOOKUP_TIMEOUT_MS);
      subscription = this.relay.subscribe(
        [{ authors: [pubkey], kinds: [0], limit: 1 }],
        {
          oneose: finish,
          onclose: finish,
          onevent: (event: Event) => {
            if (!latest || event.created_at > latest.created_at) latest = event;
          },
        },
      );
    });
    this.profileNames.set(pubkey, name);
    return name;
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
    watchCommunityRoster: boolean,
    onEvent: (event: Event) => void,
    onClose: (reason: string) => void,
  ): void {
    this.closeSubscriptions("routes changed");

    // The channel filter and the roster filter MUST be separate subscriptions.
    //
    // Buzz scopes a whole subscription to one channel via
    // extract_channel_id_from_filters, which returns None the moment ANY filter
    // lacks an `#h` tag. The roster filter has none, so combining them made the
    // entire subscription global — and the relay's fan-out deliberately never
    // routes channel-scoped events to global subscribers:
    //
    //   "Global subscriptions (channel_id = None) do NOT receive
    //    channel-scoped events."
    //
    // The channel subscription then received live messages never, only the
    // stored events its REQ returned. That is why events arrived exclusively
    // right after a reconnect, why latency equalled the rebuild interval, and
    // why only the home relay was affected — it is the one that watches the
    // roster.
    if (routes.length > 0) {
      this.subscriptions.push(
        this.relay.subscribe(
          [
            {
              "#h": [...new Set(routes.map((route) => route.localChannelId))],
              kinds: [9],
              since: Math.min(
                ...routes.map((route) => route.lastEventCreatedAt),
              ),
            },
          ],
          { onevent: onEvent, onclose: onClose },
        ),
      );
    }
    if (watchCommunityRoster) {
      this.subscriptions.push(
        this.relay.subscribe([{ kinds: [COMMUNITY_ROSTER_KIND] }], {
          onevent: onEvent,
          onclose: onClose,
        }),
      );
    }
  }

  private closeSubscriptions(reason: string): void {
    for (const subscription of this.subscriptions) subscription.close(reason);
    this.subscriptions = [];
  }

}

export async function reconcileHomeCommunityMembers(
  relay: RelayConnection,
  privateKey: Uint8Array,
  shouldContinue: () => boolean = () => true,
): Promise<number | null> {
  const roster = await relay.readRoster();
  if (!roster) return null;
  const channelId = homeCommunityChannelId();
  const groupMembers = await relay.readGroupMembers(channelId);
  if (!groupMembers) return null;

  let added = 0;
  for (const pubkey of roster) {
    if (groupMembers.has(pubkey)) continue;
    if (!shouldContinue()) return added;
    const event = finalizeEvent(
      {
        content: "",
        created_at: Math.floor(Date.now() / 1_000),
        kind: PUT_USER_KIND,
        tags: [
          ["h", channelId],
          ["p", pubkey],
          ["role", "member"],
        ],
      },
      privateKey,
    );
    await relay.publish(event);
    groupMembers.add(pubkey);
    added += 1;
  }
  return added;
}

export function isOperatedCommunityRelay(relayUrl: string): boolean {
  try {
    return new URL(relayUrl).href === new URL(homeCommunityRelayUrl()).href;
  } catch {
    return false;
  }
}

function parseMemberPubkeys(
  event: Event,
  tagName: "member" | "p",
): Set<string> {
  const members = new Set<string>();
  for (const tag of event.tags) {
    const pubkey = tag[0] === tagName ? tag[1] : undefined;
    if (typeof pubkey === "string" && /^[a-f0-9]{64}$/.test(pubkey)) {
      members.add(pubkey);
    }
  }
  return members;
}

export function parseRosterRoles(event: Event): CommunityRoster {
  const roster: CommunityRoster = new Map();
  for (const tag of event.tags) {
    if (tag[0] !== "member" && tag[0] !== "p") continue;
    const pubkey = tag[1];
    if (typeof pubkey !== "string" || !/^[a-f0-9]{64}$/.test(pubkey)) {
      continue;
    }
    const role = (tag[3] ?? tag[2] ?? "member").toString().toLowerCase();
    roster.set(pubkey, role || "member");
  }
  return roster;
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

function profileDisplayName(event: Event | undefined): string | null {
  if (!event) return null;
  try {
    const profile = JSON.parse(event.content) as {
      display_name?: unknown;
      name?: unknown;
    };
    const candidate =
      typeof profile.display_name === "string"
        ? profile.display_name
        : typeof profile.name === "string"
          ? profile.name
          : "";
    const normalized = candidate.replace(/[\r\n\t]+/g, " ").trim();
    return normalized ? normalized.slice(0, 80) : null;
  } catch {
    return null;
  }
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
