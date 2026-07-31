import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import { PgBoss } from "pg-boss";
import type { Event } from "nostr-tools/core";
import {
  finalizeEvent,
  getPublicKey,
} from "nostr-tools/pure";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createDatabasePool,
  getDatabaseConnectionOptions,
} from "../db/pool";
import {
  BRIDGE_DELIVERY_QUEUE,
  configureQueues,
} from "../jobs/queues";
import {
  ConnectorSupervisor,
  type RelayConnection,
  type RelayConnectionFactory,
} from "./connector";
import {
  acceptSharedChannel,
  activateCommunityConnection,
  beginCommunityConnectionInstall,
  createSharedChannel,
  disconnectSharedChannel,
  getSharedChannelAdminWorkspace,
  ingestBridgeMessage,
  listSharedChannelEndpoints,
  pauseSharedChannelEndpoint,
  resumeSharedChannelEndpoint,
} from "./store";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const wrappingKey = Buffer.alloc(32, 7);

describeDatabase("shared-channel PostgreSQL integration", () => {
  let pool: Pool;
  let boss: PgBoss;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    pool = createDatabasePool();
    boss = new PgBoss(
      getDatabaseConnectionOptions("buzzrouter-shared-channel-tests"),
    );
    await boss.start();
    await configureQueues(boss);
  });

  beforeEach(async () => {
    await boss.deleteAllJobs(BRIDGE_DELIVERY_QUEUE);
    await pool.query(`
      TRUNCATE
        shared_channel_audit_events,
        bridge_event_mappings,
        bridge_deliveries,
        bridge_messages,
        shared_channel_endpoints,
        shared_channels,
        connection_install_tokens,
        community_connections,
        communities,
        community_candidates
      CASCADE
    `);
  });

  afterAll(async () => {
    await boss?.stop();
    await pool?.end();
  });

  it("enforces endpoint-owned pause and immediate disconnect", async () => {
    const route = await createActiveRoute(pool);

    await expect(
      pauseSharedChannelEndpoint(pool, {
        communityId: route.source.communityId,
        idempotencyKey: "wrong-owner-pause-1",
        ownerPubkey: route.destination.ownerPubkey,
        sharedChannelId: route.sharedChannelId,
      }),
    ).rejects.toMatchObject({
      code: "community_owner_required",
      status: 403,
    });

    await pauseSharedChannelEndpoint(pool, {
      communityId: route.source.communityId,
      idempotencyKey: "pause-source-1",
      ownerPubkey: route.source.ownerPubkey,
      sharedChannelId: route.sharedChannelId,
    });

    await expect(
      resumeSharedChannelEndpoint(pool, {
        communityId: route.destination.communityId,
        idempotencyKey: "wrong-resume-1",
        ownerPubkey: route.destination.ownerPubkey,
        sharedChannelId: route.sharedChannelId,
      }),
    ).rejects.toMatchObject({
      code: "shared_channel_state_conflict",
      status: 409,
    });

    let endpoints = await listSharedChannelEndpoints(
      pool,
      route.sharedChannelId,
    );
    expect(
      endpoints.find(
        (endpoint) =>
          endpoint.communityId === route.source.communityId,
      )?.state,
    ).toBe("paused");

    await resumeSharedChannelEndpoint(pool, {
      communityId: route.source.communityId,
      idempotencyKey: "resume-source-1",
      ownerPubkey: route.source.ownerPubkey,
      sharedChannelId: route.sharedChannelId,
    });
    const sourceWorkspace = await getSharedChannelAdminWorkspace(
      pool,
      route.source.ownerPubkey,
    );
    expect(sourceWorkspace.communities).toHaveLength(1);
    expect(sourceWorkspace.channels).toMatchObject([
      {
        id: route.sharedChannelId,
        ownCommunityId: route.source.communityId,
        ownEndpointState: "active",
        peerCommunityId: route.destination.communityId,
      },
    ]);
    const sourceEndpoint = endpoints.find(
      (endpoint) => endpoint.role === "source",
    );
    if (!sourceEndpoint) throw new Error("Source endpoint missing.");
    const queuedMessage = await ingestBridgeMessage(pool, boss, {
      body: "Cancel this delivery when the route disconnects.",
      bodySha256: sha256(
        "Cancel this delivery when the route disconnects.",
      ),
      messageId: randomUUID(),
      sharedChannelId: route.sharedChannelId,
      signedEvent: { id: hex(32), kind: 9 },
      sourceActorPubkey: hex(32),
      sourceCreatedAt: Math.floor(Date.now() / 1_000),
      sourceEndpointId: sourceEndpoint.id,
      sourceEventId: hex(32),
    });
    await disconnectSharedChannel(pool, {
      communityId: route.destination.communityId,
      idempotencyKey: "disconnect-destination-1",
      ownerPubkey: route.destination.ownerPubkey,
      sharedChannelId: route.sharedChannelId,
    });

    endpoints = await listSharedChannelEndpoints(
      pool,
      route.sharedChannelId,
    );
    expect(endpoints.map((endpoint) => endpoint.state)).toEqual([
      "disconnected",
      "disconnected",
    ]);
    const connections = await pool.query<{ state: string }>(
      `
        SELECT state
        FROM community_connections
        ORDER BY community_id
      `,
    );
    expect(connections.rows.map((row) => row.state)).toEqual([
      "active",
      "active",
    ]);
    const delivery = await pool.query<{ state: string }>(
      "SELECT state FROM bridge_deliveries WHERE id = $1",
      [queuedMessage.deliveryId],
    );
    expect(delivery.rows[0].state).toBe("cancelled");
  });

  it("does not accept an expired invitation", async () => {
    const source = await createConnectedCommunity(pool, "source");
    const destination = await createConnectedCommunity(
      pool,
      "destination",
    );
    const channel = await createSharedChannel(pool, {
      destinationCommunityId: destination.communityId,
      expiresAt: new Date(Date.now() - 1_000),
      idempotencyKey: "expired-proposal-1",
      ownerPubkey: source.ownerPubkey,
      proposedName: "expired-channel",
      purpose: "Verify invitation expiry",
      sourceChannelId: randomUUID(),
      sourceChannelName: "expired-channel",
      sourceCommunityId: source.communityId,
    });

    await expect(
      acceptSharedChannel(pool, {
        communityId: destination.communityId,
        idempotencyKey: "expired-accept-1",
        localChannelId: randomUUID(),
        localChannelName: "destination-channel",
        ownerPubkey: destination.ownerPubkey,
        sharedChannelId: channel.id,
      }),
    ).rejects.toMatchObject({
      code: "invitation_expired",
      status: 409,
    });
  });

  it("commits the message, delivery, and pg-boss job once", async () => {
    const route = await createActiveRoute(pool);
    const sourceEndpoint = (
      await listSharedChannelEndpoints(pool, route.sharedChannelId)
    ).find((endpoint) => endpoint.role === "source");
    if (!sourceEndpoint) throw new Error("Source endpoint missing.");

    const sourceEventId = hex(32);
    const messageId = randomUUID();
    const first = await ingestBridgeMessage(pool, boss, {
      body: "Review the benchmark methodology.",
      bodySha256: sha256("Review the benchmark methodology."),
      messageId,
      sharedChannelId: route.sharedChannelId,
      signedEvent: { id: sourceEventId, kind: 9 },
      sourceActorPubkey: hex(32),
      sourceCreatedAt: Math.floor(Date.now() / 1_000),
      sourceEndpointId: sourceEndpoint.id,
      sourceEventId,
    });

    expect(first.created).toBe(true);
    await expect(
      boss.findJobs(BRIDGE_DELIVERY_QUEUE, { id: messageId }),
    ).resolves.toHaveLength(1);

    const duplicate = await ingestBridgeMessage(pool, boss, {
      body: "Review the benchmark methodology.",
      bodySha256: sha256("Review the benchmark methodology."),
      messageId: randomUUID(),
      sharedChannelId: route.sharedChannelId,
      signedEvent: { id: sourceEventId, kind: 9 },
      sourceActorPubkey: hex(32),
      sourceCreatedAt: Math.floor(Date.now() / 1_000),
      sourceEndpointId: sourceEndpoint.id,
      sourceEventId,
    });
    expect(duplicate).toEqual({
      created: false,
      deliveryId: first.deliveryId,
      messageId,
    });
    await expect(
      boss.findJobs(BRIDGE_DELIVERY_QUEUE, { id: messageId }),
    ).resolves.toHaveLength(1);
  });

  it("rolls back message state when queue insertion fails", async () => {
    const route = await createActiveRoute(pool);
    const sourceEndpoint = (
      await listSharedChannelEndpoints(pool, route.sharedChannelId)
    ).find((endpoint) => endpoint.role === "source");
    if (!sourceEndpoint) throw new Error("Source endpoint missing.");
    const sourceEventId = hex(32);
    const failingBoss = {
      send: async () => {
        throw new Error("queue unavailable");
      },
    } as unknown as PgBoss;

    await expect(
      ingestBridgeMessage(pool, failingBoss, {
        body: "This transaction must roll back.",
        bodySha256: sha256("This transaction must roll back."),
        messageId: randomUUID(),
        sharedChannelId: route.sharedChannelId,
        signedEvent: { id: sourceEventId, kind: 9 },
        sourceActorPubkey: hex(32),
        sourceCreatedAt: Math.floor(Date.now() / 1_000),
        sourceEndpointId: sourceEndpoint.id,
        sourceEventId,
      }),
    ).rejects.toThrow("queue unavailable");

    const counts = await pool.query<{
      deliveries: string;
      messages: string;
    }>(`
      SELECT
        (SELECT count(*) FROM bridge_messages)::text AS messages,
        (SELECT count(*) FROM bridge_deliveries)::text AS deliveries
    `);
    expect(counts.rows[0]).toEqual({
      deliveries: "0",
      messages: "0",
    });
  });

  it("ingests and delivers through the connector supervisor", async () => {
    const route = await createActiveRoute(pool);
    const endpoints = await listSharedChannelEndpoints(
      pool,
      route.sharedChannelId,
    );
    const sourceEndpoint = endpoints.find(
      (endpoint) => endpoint.role === "source",
    );
    if (!sourceEndpoint?.localChannelId) {
      throw new Error("Source endpoint missing.");
    }
    const relayRows = await pool.query<{
      community_id: string;
      relay_url_snapshot: string;
    }>(
      `
        SELECT community_id, relay_url_snapshot
        FROM community_connections
      `,
    );
    const sourceRelayUrl = relayRows.rows.find(
      (row) => row.community_id === route.source.communityId,
    )?.relay_url_snapshot;
    const destinationRelayUrl = relayRows.rows.find(
      (row) =>
        row.community_id === route.destination.communityId,
    )?.relay_url_snapshot;
    if (!sourceRelayUrl || !destinationRelayUrl) {
      throw new Error("Relay fixtures missing.");
    }

    const relayFactory = new FakeRelayFactory();
    const supervisor = new ConnectorSupervisor(
      pool,
      boss,
      {
        getKey: async () => wrappingKey,
      },
      relayFactory,
    );
    await supervisor.start();
    try {
      const sourceEvent = finalizeEvent(
        {
          content: "Deliver this through the bridge.",
          created_at: Math.floor(Date.now() / 1_000),
          kind: 9,
          tags: [["h", sourceEndpoint.localChannelId]],
        },
        randomBytes(32),
      );
      relayFactory.get(sourceRelayUrl).emit(sourceEvent);
      await waitFor(async () => {
        const result = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM bridge_deliveries",
        );
        return result.rows[0].count === "1";
      });

      const delivery = await pool.query<{ id: string }>(
        "SELECT id FROM bridge_deliveries",
      );
      await supervisor.deliver(delivery.rows[0].id);

      const destinationRelay = relayFactory.get(destinationRelayUrl);
      expect(destinationRelay.published).toHaveLength(1);
      expect(destinationRelay.published[0].tags).toContainEqual([
        "h",
        endpoints.find(
          (endpoint) => endpoint.role === "destination",
        )?.localChannelId,
      ]);
      const state = await pool.query<{ state: string }>(
        "SELECT state FROM bridge_deliveries WHERE id = $1",
        [delivery.rows[0].id],
      );
      expect(state.rows[0].state).toBe("delivered_to_relay");
    } finally {
      await supervisor.stop();
    }
  });
});

interface CommunityFixture {
  communityId: string;
  ownerPubkey: string;
}

async function createActiveRoute(pool: Pool): Promise<{
  destination: CommunityFixture;
  sharedChannelId: string;
  source: CommunityFixture;
}> {
  const source = await createConnectedCommunity(pool, "source");
  const destination = await createConnectedCommunity(
    pool,
    "destination",
  );
  const channel = await createSharedChannel(pool, {
    destinationCommunityId: destination.communityId,
    idempotencyKey: "propose-route-1",
    ownerPubkey: source.ownerPubkey,
    proposedName: "partner-research",
    purpose: "Review benchmark methodology",
    sourceChannelId: randomUUID(),
    sourceChannelName: "partner-research",
    sourceCommunityId: source.communityId,
  });
  await acceptSharedChannel(pool, {
    communityId: destination.communityId,
    idempotencyKey: "accept-route-1",
    localChannelId: randomUUID(),
    localChannelName: "external-research",
    ownerPubkey: destination.ownerPubkey,
    sharedChannelId: channel.id,
  });
  return {
    destination,
    sharedChannelId: channel.id,
    source,
  };
}

async function createConnectedCommunity(
  pool: Pool,
  name: string,
): Promise<CommunityFixture> {
  const ownerPubkey = hex(32);
  const candidate = await pool.query<{ id: string }>(
    `
      INSERT INTO community_candidates (
        canonical_relay_url,
        host,
        state
      )
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [`wss://${name}-${randomUUID()}.example.com`, `${name}.example.com`],
  );
  const community = await pool.query<{ id: string }>(
    `
      INSERT INTO communities (
        candidate_id,
        claim_state,
        owner_pubkey
      )
      VALUES ($1, 'admin_verified', $2)
      RETURNING id
    `,
    [candidate.rows[0].id, ownerPubkey],
  );
  const communityId = community.rows[0].id;
  const tokenHash = hex(32);
  const privateKey = randomBytes(32);
  await beginCommunityConnectionInstall(pool, {
    bridgePubkey: getPublicKey(privateKey),
    communityId,
    ownerPubkey,
    privateKey,
    tokenHash,
    wrappingKey,
    wrappingKeyVersion: 1,
  });
  await activateCommunityConnection(pool, tokenHash, {
    challengeEventId: hex(32),
  });
  return { communityId, ownerPubkey };
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

class FakeRelayFactory implements RelayConnectionFactory {
  private readonly relays = new Map<string, FakeRelayConnection>();

  async connect(
    relayUrl: string,
    _privateKey: Uint8Array,
  ): Promise<RelayConnection> {
    const relay = new FakeRelayConnection();
    this.relays.set(relayUrl, relay);
    return relay;
  }

  get(relayUrl: string): FakeRelayConnection {
    const relay = this.relays.get(relayUrl);
    if (!relay) throw new Error(`Fake relay unavailable: ${relayUrl}`);
    return relay;
  }
}

class FakeRelayConnection implements RelayConnection {
  private onEvent: ((event: Event) => void) | undefined;
  readonly published: Event[] = [];

  close(): void {
    this.onEvent = undefined;
  }

  emit(event: Event): void {
    this.onEvent?.(event);
  }

  async hasEvent(eventId: string): Promise<boolean> {
    return this.published.some((event) => event.id === eventId);
  }

  async publish(event: Event): Promise<void> {
    this.published.push(event);
  }

  subscribe(
    _routes: unknown[],
    onEvent: (event: Event) => void,
    _onClose: (reason: string) => void,
  ): void {
    this.onEvent = onEvent;
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for integration state.");
}
