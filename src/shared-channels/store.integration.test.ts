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
  type CommunityRoster,
  type ConfirmationSubscription,
  type RelayConnection,
  type RelayConnectionFactory,
  type RelayGroup,
} from "./connector";
import { listCommunityLocalChannels } from "./local-channels";
import {
  beginConnectionFromInvite,
  getCommunityInstallDescriptor,
  hashInstallToken,
  type InviteClaimTarget,
  redeemInviteAndActivate,
  verifyAndActivateCommunityConnection,
} from "./installer";
import {
  mintOwnerSession,
  resolveOwnerSession,
} from "./owner-session";
import {
  activateCommunityConnection,
  armSharedChannelConfirmation,
  beginCommunityConnectionInstall,
  confirmSharedChannelBinding,
  connectFeaturedCommunity,
  createSharedChannel,
  disconnectSharedChannel,
  enrollVerifiedCommunityFromInvite,
  findVerifiedCommunityCandidateByRelayUrl,
  getSharedChannelAdminWorkspace,
  ingestBridgeMessage,
  listSharedChannelEndpoints,
  pauseSharedChannelEndpoint,
  resumeSharedChannelEndpoint,
  type ConnectorRouteConfig,
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
        shared_channel_confirmations,
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

  it("activates an install token only after a relay round trip", async () => {
    const community = await createVerifiedCommunity(pool, "installer");
    const token = randomBytes(32).toString("base64url");
    const privateKey = randomBytes(32);
    const bridgePubkey = getPublicKey(privateKey);
    await beginCommunityConnectionInstall(pool, {
      bridgePubkey,
      communityId: community.communityId,
      ownerPubkey: community.ownerPubkey,
      privateKey,
      tokenHash: hashInstallToken(token),
      wrappingKey,
      wrappingKeyVersion: 1,
    });
    const descriptor = await getCommunityInstallDescriptor(pool, token);
    expect(descriptor).toMatchObject({
      bridgePubkey,
      relayUrl: community.relayUrl,
    });

    const relays = new FakeRelayFactory();
    const connection = await verifyAndActivateCommunityConnection(
      pool,
      token,
      { getKey: async () => wrappingKey },
      relays,
    );
    expect(connection.state).toBe("active");
    expect(relays.get(community.relayUrl).published).toMatchObject([
      { kind: 0, pubkey: bridgePubkey },
    ]);
    await expect(
      verifyAndActivateCommunityConnection(
        pool,
        token,
        { getKey: async () => wrappingKey },
        relays,
      ),
    ).rejects.toMatchObject({ code: "install_token_unavailable" });
  });

  it("redeems a pasted invite link then activates over the round trip", async () => {
    const community = await createVerifiedCommunity(pool, "invite");
    const token = randomBytes(32).toString("base64url");
    const privateKey = randomBytes(32);
    const bridgePubkey = getPublicKey(privateKey);
    await beginCommunityConnectionInstall(pool, {
      bridgePubkey,
      communityId: community.communityId,
      ownerPubkey: community.ownerPubkey,
      privateKey,
      tokenHash: hashInstallToken(token),
      wrappingKey,
      wrappingKeyVersion: 1,
    });

    const host = new URL(community.relayUrl).host;
    const claims: InviteClaimTarget[] = [];
    const relays = new FakeRelayFactory();
    const connection = await redeemInviteAndActivate(
      pool,
      token,
      `https://${host}/invite/opaque-code-123`,
      { getKey: async () => wrappingKey },
      relays,
      async (_privateKey, target) => {
        claims.push(target);
      },
    );

    // The bridge redeems against its own community relay, code parsed out.
    expect(claims).toEqual([
      {
        claimUrl: `https://${host}/api/invites/claim`,
        code: "opaque-code-123",
      },
    ]);
    // The unchanged kind-0 round trip still proves real admission.
    expect(connection.state).toBe("active");
    expect(relays.get(community.relayUrl).published).toMatchObject([
      { kind: 0, pubkey: bridgePubkey },
    ]);
  });

  it("leaves the token reusable when invite redemption fails", async () => {
    const community = await createVerifiedCommunity(pool, "invite-fail");
    const token = randomBytes(32).toString("base64url");
    const privateKey = randomBytes(32);
    const bridgePubkey = getPublicKey(privateKey);
    await beginCommunityConnectionInstall(pool, {
      bridgePubkey,
      communityId: community.communityId,
      ownerPubkey: community.ownerPubkey,
      privateKey,
      tokenHash: hashInstallToken(token),
      wrappingKey,
      wrappingKeyVersion: 1,
    });
    const host = new URL(community.relayUrl).host;

    await expect(
      redeemInviteAndActivate(
        pool,
        token,
        `https://${host}/invite/opaque-code-123`,
        { getKey: async () => wrappingKey },
        new FakeRelayFactory(),
        async () => {
          throw new Error("relay rejected the invite");
        },
      ),
    ).rejects.toThrow("relay rejected the invite");

    // A failed claim must not consume the token — the owner can retry.
    const connection = await redeemInviteAndActivate(
      pool,
      token,
      `https://${host}/invite/opaque-code-123`,
      { getKey: async () => wrappingKey },
      new FakeRelayFactory(),
      async () => {},
    );
    expect(connection.state).toBe("active");
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

  it("flags and ranks the home community as the canonical destination", async () => {
    const owner = await createConnectedCommunity(pool, "owner");
    await setOpenToSharedChannels(pool, owner.communityId, true);
    const home = await createConnectedCommunity(pool, "home");
    await setOpenToSharedChannels(pool, home.communityId, true);
    await pool.query(
      "UPDATE community_candidates SET host = $2 WHERE id = (SELECT candidate_id FROM communities WHERE id = $1)",
      [home.communityId, "home.buzzrouter.test"],
    );

    const previous = process.env.BUZZROUTER_HOME_COMMUNITY_HOST;
    process.env.BUZZROUTER_HOME_COMMUNITY_HOST = "home.buzzrouter.test";
    try {
      const workspace = await getSharedChannelAdminWorkspace(
        pool,
        owner.ownerPubkey,
      );
      expect(workspace.destinations[0]).toMatchObject({
        featured: true,
        id: home.communityId,
      });
      expect(
        workspace.destinations
          .filter((community) => community.id !== home.communityId)
          .every((community) => community.featured === false),
      ).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.BUZZROUTER_HOME_COMMUNITY_HOST;
      } else {
        process.env.BUZZROUTER_HOME_COMMUNITY_HOST = previous;
      }
    }
  });

  it("lists every connected community as a destination", async () => {
    const owner = await createConnectedCommunity(pool, "owner");

    const defaultSettings = await createConnectedCommunity(
      pool,
      "default-settings",
    );

    const notConnected = await createVerifiedCommunity(
      pool,
      "not-connected",
    );

    const eligible = await createConnectedCommunity(pool, "eligible");
    const unverified = await createConnectedCommunity(pool, "unverified");
    await pool.query(
      `
        UPDATE community_candidates
        SET state = 'rejected'
        WHERE id = (
          SELECT candidate_id FROM communities WHERE id = $1
        )
      `,
      [unverified.communityId],
    );

    const workspace = await getSharedChannelAdminWorkspace(
      pool,
      owner.ownerPubkey,
    );
    const destinationIds = workspace.destinations.map(
      (community) => community.id,
    );
    expect(destinationIds).toContain(eligible.communityId);
    expect(destinationIds).toContain(defaultSettings.communityId);
    expect(destinationIds).not.toContain(notConnected.communityId);
    expect(destinationIds).not.toContain(unverified.communityId);

    await expect(
      getSharedChannelAdminWorkspace(pool, unverified.ownerPubkey),
    ).resolves.toEqual({ channels: [], communities: [], destinations: [] });
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
      armSharedChannelConfirmation(pool, {
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

  it("lists local channels for an owned, connected community", async () => {
    const community = await createConnectedCommunity(pool, "picker");
    const relayFactory = new GroupListingRelayFactory([
      { id: "group-2", name: "Zeta" },
      { id: "group-1", name: "Alpha" },
    ]);

    const listing = await listCommunityLocalChannels(
      pool,
      {
        communityId: community.communityId,
        ownerPubkey: community.ownerPubkey,
      },
      { getKey: async () => wrappingKey },
      relayFactory,
    );

    expect(listing.connectorActive).toBe(true);
    expect(listing.channels).toEqual([
      { id: "group-1", name: "Alpha" },
      { id: "group-2", name: "Zeta" },
    ]);
    expect(relayFactory.connectCalls).toBe(1);
    expect(relayFactory.closed).toBe(true);
  });

  it("reports the connector inactive for an owned community with no connector", async () => {
    const community = await createVerifiedCommunity(pool, "unconnected");
    const relayFactory = new GroupListingRelayFactory([]);

    const listing = await listCommunityLocalChannels(
      pool,
      {
        communityId: community.communityId,
        ownerPubkey: community.ownerPubkey,
      },
      { getKey: async () => wrappingKey },
      relayFactory,
    );

    expect(listing).toEqual({ channels: [], connectorActive: false });
    expect(relayFactory.connectCalls).toBe(0);
  });

  it("refuses to list channels for a community the caller does not own", async () => {
    const community = await createConnectedCommunity(pool, "guarded");

    await expect(
      listCommunityLocalChannels(
        pool,
        {
          communityId: community.communityId,
          ownerPubkey: hex(32),
        },
        { getKey: async () => wrappingKey },
        new GroupListingRelayFactory([]),
      ),
    ).rejects.toMatchObject({
      code: "community_owner_required",
      status: 403,
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

  describe("chat-proof confirmation authorization", () => {
    it("activates the route when an owner types the code", async () => {
      const armed = await armPendingRoute(pool);
      await withSupervisorHearing(pool, boss, async (relays) => {
        const relay = relays.get(armed.destinationRelayUrl);
        relay.roster = new Map([[armed.destination.ownerPubkey, "owner"]]);
        relay.emit(
          confirmationEvent(
            armed.destination.ownerPubkey,
            armed.localChannelId,
            armed.code,
          ),
        );
        await waitFor(
          async () =>
            (await endpointState(
              pool,
              armed.sharedChannelId,
              armed.destination.communityId,
            )) === "active",
        );
      });
      expect(await channelState(pool, armed.sharedChannelId)).toBe("active");
      expect(await confirmationState(pool, armed.confirmationId)).toBe(
        "consumed",
      );
    });

    it("refuses when an ordinary member types the code", async () => {
      const armed = await armPendingRoute(pool);
      await withSupervisorHearing(pool, boss, async (relays) => {
        const relay = relays.get(armed.destinationRelayUrl);
        relay.roster = new Map([[armed.destination.ownerPubkey, "member"]]);
        relay.emit(
          confirmationEvent(
            armed.destination.ownerPubkey,
            armed.localChannelId,
            armed.code,
          ),
        );
        await settleConfirmation();
      });
      expect(
        await endpointState(
          pool,
          armed.sharedChannelId,
          armed.destination.communityId,
        ),
      ).toBe("pending");
      expect(await confirmationState(pool, armed.confirmationId)).toBe(
        "pending",
      );
    });

    it("fails closed when the roster cannot be read", async () => {
      const armed = await armPendingRoute(pool);
      await withSupervisorHearing(pool, boss, async (relays) => {
        const relay = relays.get(armed.destinationRelayUrl);
        relay.rosterReadable = false;
        relay.emit(
          confirmationEvent(
            armed.destination.ownerPubkey,
            armed.localChannelId,
            armed.code,
          ),
        );
        await settleConfirmation();
      });
      expect(
        await endpointState(
          pool,
          armed.sharedChannelId,
          armed.destination.communityId,
        ),
      ).toBe("pending");
      expect(await confirmationState(pool, armed.confirmationId)).toBe(
        "pending",
      );
    });

    it("refuses a replayed code", async () => {
      const armed = await armPendingRoute(pool);
      await withSupervisorHearing(pool, boss, async (relays) => {
        const relay = relays.get(armed.destinationRelayUrl);
        relay.roster = new Map([[armed.destination.ownerPubkey, "owner"]]);
        relay.emit(
          confirmationEvent(
            armed.destination.ownerPubkey,
            armed.localChannelId,
            armed.code,
          ),
        );
        await waitFor(
          async () =>
            (await confirmationState(pool, armed.confirmationId)) ===
            "consumed",
        );
        // Same code, second event: nothing pending matches -> refused.
        relay.emit(
          confirmationEvent(
            armed.destination.ownerPubkey,
            armed.localChannelId,
            armed.code,
          ),
        );
        await settleConfirmation();
      });
      const replays = await pool.query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM shared_channel_audit_events
          WHERE shared_channel_id = $1
            AND action = 'shared_channel.accepted'
        `,
        [armed.sharedChannelId],
      );
      expect(replays.rows[0].count).toBe("1");
    });

    it("refuses an expired code", async () => {
      const armed = await armPendingRoute(pool);
      await withSupervisorHearing(pool, boss, async (relays) => {
        const relay = relays.get(armed.destinationRelayUrl);
        relay.roster = new Map([[armed.destination.ownerPubkey, "owner"]]);
        await pool.query(
          `
            UPDATE shared_channel_confirmations
            SET expires_at = now() - interval '1 second'
            WHERE id = $1
          `,
          [armed.confirmationId],
        );
        relay.emit(
          confirmationEvent(
            armed.destination.ownerPubkey,
            armed.localChannelId,
            armed.code,
          ),
        );
        await settleConfirmation();
      });
      expect(
        await endpointState(
          pool,
          armed.sharedChannelId,
          armed.destination.communityId,
        ),
      ).toBe("pending");
    });
  });

  describe("signer-free link flow", () => {
    async function makeFeatured(pool: Pool): Promise<CommunityFixture> {
      const featured = await createConnectedCommunity(pool, "featured");
      await pool.query(
        `
          UPDATE community_candidates
          SET host = $2
          WHERE id = (
            SELECT candidate_id FROM communities WHERE id = $1
          )
        `,
        [featured.communityId, homeHost],
      );
      return featured;
    }

    it("identifies an existing community from its relay url", async () => {
      const community = await createVerifiedCommunity(pool, "by-relay");
      const candidate = await findVerifiedCommunityCandidateByRelayUrl(
        pool,
        community.relayUrl,
      );
      const found = await enrollVerifiedCommunityFromInvite(
        pool,
        candidate.candidateId,
        "f".repeat(64),
      );
      expect(found).toMatchObject({
        communityId: community.communityId,
        ownerPubkey: community.ownerPubkey,
        relayUrl: community.relayUrl,
      });

      await expect(
        findVerifiedCommunityCandidateByRelayUrl(
          pool,
          "wss://nobody.example.com",
        ),
      ).rejects.toMatchObject({
        code: "invite_community_unknown",
        status: 404,
      });
    });

    it("enrolls a bare verified candidate for invite-link administration", async () => {
      const candidate = await pool.query<{ id: string }>(
        `
          INSERT INTO community_candidates (
            canonical_relay_url, host, state
          )
          VALUES ('wss://bare-invite.example.com', 'bare-invite.example.com', 'verified_buzz')
          RETURNING id
        `,
      );
      const sessionPrincipal = "e".repeat(64);

      const candidateMatch = await findVerifiedCommunityCandidateByRelayUrl(
        pool,
        "wss://bare-invite.example.com",
      );
      const found = await enrollVerifiedCommunityFromInvite(
        pool,
        candidateMatch.candidateId,
        sessionPrincipal,
      );

      expect(found).toMatchObject({
        displayName: "bare-invite.example.com",
        ownerPubkey: sessionPrincipal,
        relayUrl: "wss://bare-invite.example.com",
      });
      const enrolled = await pool.query<{
        claim_state: string;
        owner_pubkey: string;
      }>(
        "SELECT claim_state, owner_pubkey FROM communities WHERE candidate_id = $1",
        [candidate.rows[0].id],
      );
      expect(enrolled.rows[0]).toEqual({
        claim_state: "unclaimed",
        owner_pubkey: sessionPrincipal,
      });
    });

    it("does not persist enrollment or connector state when invite redemption fails", async () => {
      const candidate = await pool.query<{ id: string }>(
        `
          INSERT INTO community_candidates (
            canonical_relay_url, host, state
          )
          VALUES ('wss://rejected-invite.example.com', 'rejected-invite.example.com', 'verified_buzz')
          RETURNING id
        `,
      );

      await expect(
        beginConnectionFromInvite(
          pool,
          "https://rejected-invite.example.com/invite/expired",
          { getKey: async () => wrappingKey },
          {} as RelayConnectionFactory,
          async () => {
            throw new Error("relay rejected invite");
          },
        ),
      ).rejects.toThrow("relay rejected invite");

      const state = await pool.query<{ communities: string; connections: string }>(
        `
          SELECT
            (SELECT count(*)::text FROM communities WHERE candidate_id = $1)
              AS communities,
            (
              SELECT count(*)::text
              FROM community_connections
              WHERE community_id IN (
                SELECT id FROM communities WHERE candidate_id = $1
              )
            ) AS connections
        `,
        [candidate.rows[0].id],
      );
      expect(state.rows[0]).toEqual({ communities: "0", connections: "0" });
    });

    it("mints and resolves a community-scoped owner session", async () => {
      const community = await createVerifiedCommunity(pool, "session");
      const minted = await mintOwnerSession(pool, {
        communityId: community.communityId,
        ownerPubkey: community.ownerPubkey,
      });
      await expect(
        resolveOwnerSession(pool, minted.session),
      ).resolves.toEqual({
        communityId: community.communityId,
        ownerPubkey: community.ownerPubkey,
      });

      await pool.query(
        `
          UPDATE connection_owner_sessions
          SET expires_at = now() - interval '1 second'
        `,
      );
      await expect(
        resolveOwnerSession(pool, minted.session),
      ).rejects.toMatchObject({ code: "owner_session_invalid", status: 401 });
    });

    it("arms a BuzzRouter link the caller finishes with the roster code", async () => {
      const previous = process.env.BUZZROUTER_HOME_COMMUNITY_HOST;
      process.env.BUZZROUTER_HOME_COMMUNITY_HOST = homeHost;
      try {
        const featured = await makeFeatured(pool);
        const caller = await createConnectedCommunity(pool, "caller");

        const armed = await connectFeaturedCommunity(pool, {
          communityId: caller.communityId,
          idempotencyKey: `featured-${randomUUID()}`,
          localChannelId: randomUUID(),
          localChannelName: "welcome",
          ownerPubkey: caller.ownerPubkey,
        });
        expect(armed.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

        const endpoints = await listSharedChannelEndpoints(
          pool,
          armed.sharedChannelId,
        );
        const source = endpoints.find((e) => e.role === "source");
        const destination = endpoints.find((e) => e.role === "destination");
        // BuzzRouter proposes (so the caller reuses the roster-gated accept
        // path) on a channel id scoped to the caller — never the shared one
        // that would trip the per-community unique index.
        expect(source).toMatchObject({
          communityId: featured.communityId,
          localChannelId: `buzzrouter:${caller.communityId}`,
          state: "active",
        });
        expect(destination).toMatchObject({
          communityId: caller.communityId,
          state: "pending",
        });

        // The roster-signed code the caller types is still the real authority.
        const confirmation = await pool.query<{ id: string }>(
          `
            SELECT id FROM shared_channel_confirmations
            WHERE shared_channel_id = $1 AND state = 'pending'
          `,
          [armed.sharedChannelId],
        );
        const result = await confirmSharedChannelBinding(pool, {
          actorCreatedAt: Math.floor(Date.now() / 1_000),
          actorEventId: hex(32),
          actorPubkey: caller.ownerPubkey,
          confirmationId: confirmation.rows[0].id,
        });
        expect(result.activated).toBe(true);
        expect(
          await endpointState(
            pool,
            armed.sharedChannelId,
            caller.communityId,
          ),
        ).toBe("active");
      } finally {
        restoreHomeHost(previous);
      }
    });

    it("lets two communities both connect to the featured community", async () => {
      const previous = process.env.BUZZROUTER_HOME_COMMUNITY_HOST;
      process.env.BUZZROUTER_HOME_COMMUNITY_HOST = homeHost;
      try {
        await makeFeatured(pool);
        const first = await createConnectedCommunity(pool, "first");
        const second = await createConnectedCommunity(pool, "second");

        for (const caller of [first, second]) {
          const armed = await connectFeaturedCommunity(pool, {
            communityId: caller.communityId,
            idempotencyKey: `featured-${randomUUID()}`,
            localChannelId: randomUUID(),
            localChannelName: "welcome",
            ownerPubkey: caller.ownerPubkey,
          });
          expect(armed.sharedChannelId).toBeTruthy();
        }
      } finally {
        restoreHomeHost(previous);
      }
    });

    it("reports the featured community unavailable when it has no connector", async () => {
      const previous = process.env.BUZZROUTER_HOME_COMMUNITY_HOST;
      process.env.BUZZROUTER_HOME_COMMUNITY_HOST = homeHost;
      try {
        // A verified featured community but with no active connection.
        const featured = await createVerifiedCommunity(pool, "featured-cold");
        await pool.query(
          `
            UPDATE community_candidates SET host = $2
            WHERE id = (SELECT candidate_id FROM communities WHERE id = $1)
          `,
          [featured.communityId, homeHost],
        );
        const caller = await createConnectedCommunity(pool, "caller-cold");

        await expect(
          connectFeaturedCommunity(pool, {
            communityId: caller.communityId,
            idempotencyKey: `featured-${randomUUID()}`,
            localChannelId: randomUUID(),
            localChannelName: "welcome",
            ownerPubkey: caller.ownerPubkey,
          }),
        ).rejects.toMatchObject({
          code: "featured_unavailable",
          status: 503,
        });
      } finally {
        restoreHomeHost(previous);
      }
    });
  });
});

const homeHost = "featured.buzzrouter.test";

function restoreHomeHost(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.BUZZROUTER_HOME_COMMUNITY_HOST;
  } else {
    process.env.BUZZROUTER_HOME_COMMUNITY_HOST = previous;
  }
}

interface CommunityFixture {
  communityId: string;
  ownerPubkey: string;
}

interface VerifiedCommunityFixture extends CommunityFixture {
  relayUrl: string;
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
  await acceptViaConfirmation(pool, {
    communityId: destination.communityId,
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

/**
 * Drive the full two-step binding as a helper: arm the destination endpoint,
 * then consume the code the way the connector does after the roster check
 * passes. Used to reach an active route in tests that are not about the
 * authorization branches themselves.
 */
async function acceptViaConfirmation(
  pool: Pool,
  input: {
    communityId: string;
    localChannelId: string;
    localChannelName: string;
    ownerPubkey: string;
    sharedChannelId: string;
  },
): Promise<void> {
  await armSharedChannelConfirmation(pool, {
    communityId: input.communityId,
    idempotencyKey: `arm-${input.sharedChannelId}`,
    localChannelId: input.localChannelId,
    localChannelName: input.localChannelName,
    ownerPubkey: input.ownerPubkey,
    sharedChannelId: input.sharedChannelId,
  });
  const confirmation = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM shared_channel_confirmations
      WHERE shared_channel_id = $1
        AND community_id = $2
        AND state = 'pending'
    `,
    [input.sharedChannelId, input.communityId],
  );
  const result = await confirmSharedChannelBinding(pool, {
    actorCreatedAt: Math.floor(Date.now() / 1_000),
    actorEventId: hex(32),
    actorPubkey: input.ownerPubkey,
    confirmationId: confirmation.rows[0].id,
  });
  if (!result.activated) {
    throw new Error("Test route activation failed.");
  }
}

interface ArmedRoute {
  code: string;
  confirmationId: string;
  destination: CommunityFixture;
  destinationRelayUrl: string;
  localChannelId: string;
  sharedChannelId: string;
  source: CommunityFixture;
}

async function armPendingRoute(pool: Pool): Promise<ArmedRoute> {
  const source = await createConnectedCommunity(pool, "conf-source");
  const destination = await createConnectedCommunity(
    pool,
    "conf-destination",
  );
  const channel = await createSharedChannel(pool, {
    destinationCommunityId: destination.communityId,
    idempotencyKey: `propose-${randomUUID()}`,
    ownerPubkey: source.ownerPubkey,
    proposedName: "confirm-route",
    purpose: "Bind via chat proof",
    sourceChannelId: randomUUID(),
    sourceChannelName: "confirm-route",
    sourceCommunityId: source.communityId,
  });
  const localChannelId = randomUUID();
  const armed = await armSharedChannelConfirmation(pool, {
    communityId: destination.communityId,
    idempotencyKey: `arm-${randomUUID()}`,
    localChannelId,
    localChannelName: "external-confirm",
    ownerPubkey: destination.ownerPubkey,
    sharedChannelId: channel.id,
  });
  const confirmation = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM shared_channel_confirmations
      WHERE shared_channel_id = $1
        AND state = 'pending'
    `,
    [channel.id],
  );
  const relay = await pool.query<{ relay_url_snapshot: string }>(
    `
      SELECT relay_url_snapshot
      FROM community_connections
      WHERE community_id = $1
    `,
    [destination.communityId],
  );
  return {
    code: armed.code,
    confirmationId: confirmation.rows[0].id,
    destination,
    destinationRelayUrl: relay.rows[0].relay_url_snapshot,
    localChannelId,
    sharedChannelId: channel.id,
    source,
  };
}

async function withSupervisorHearing(
  pool: Pool,
  boss: PgBoss,
  run: (relays: FakeRelayFactory) => Promise<void>,
): Promise<void> {
  const relays = new FakeRelayFactory();
  const supervisor = new ConnectorSupervisor(
    pool,
    boss,
    { getKey: async () => wrappingKey },
    relays,
  );
  await supervisor.start();
  try {
    await run(relays);
  } finally {
    await supervisor.stop();
  }
}

function confirmationEvent(
  pubkey: string,
  channelId: string,
  content: string,
): Event {
  return {
    content,
    created_at: Math.floor(Date.now() / 1_000),
    id: hex(32),
    kind: 9,
    pubkey,
    sig: "0".repeat(128),
    tags: [["h", channelId]],
  } as unknown as Event;
}

/** Let the fire-and-forget confirmation handler settle before asserting. */
async function settleConfirmation(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function endpointState(
  pool: Pool,
  sharedChannelId: string,
  communityId: string,
): Promise<string> {
  const result = await pool.query<{ state: string }>(
    `
      SELECT state
      FROM shared_channel_endpoints
      WHERE shared_channel_id = $1
        AND community_id = $2
    `,
    [sharedChannelId, communityId],
  );
  return result.rows[0].state;
}

async function channelState(
  pool: Pool,
  sharedChannelId: string,
): Promise<string> {
  const result = await pool.query<{ state: string }>(
    "SELECT state FROM shared_channels WHERE id = $1",
    [sharedChannelId],
  );
  return result.rows[0].state;
}

async function confirmationState(
  pool: Pool,
  confirmationId: string,
): Promise<string> {
  const result = await pool.query<{ state: string }>(
    "SELECT state FROM shared_channel_confirmations WHERE id = $1",
    [confirmationId],
  );
  return result.rows[0].state;
}

async function createConnectedCommunity(
  pool: Pool,
  name: string,
): Promise<CommunityFixture> {
  const fixture = await createVerifiedCommunity(pool, name);
  const { communityId, ownerPubkey } = fixture;
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

async function createVerifiedCommunity(
  pool: Pool,
  name: string,
): Promise<VerifiedCommunityFixture> {
  const ownerPubkey = hex(32);
  const relayUrl = `wss://${name}-${randomUUID()}.example.com`;
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
    [relayUrl, `${name}.example.com`],
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
  return { communityId, ownerPubkey, relayUrl };
}

async function setOpenToSharedChannels(
  pool: Pool,
  communityId: string,
  open: boolean,
): Promise<void> {
  await pool.query(
    "UPDATE communities SET open_to_shared_channels = $2 WHERE id = $1",
    [communityId, open],
  );
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
  // Test controls: the roster this relay hands back, and whether reading it
  // fails (null => the connector must fail closed).
  roster: CommunityRoster | null = new Map();
  rosterReadable = true;

  close(): void {
    this.onEvent = undefined;
  }

  emit(event: Event): void {
    this.onEvent?.(event);
  }

  async hasEvent(eventId: string): Promise<boolean> {
    return this.published.some((event) => event.id === eventId);
  }

  async listGroups(): Promise<never[]> {
    return [];
  }

  async publish(event: Event): Promise<void> {
    this.published.push(event);
  }

  async readRoster(): Promise<CommunityRoster | null> {
    return this.rosterReadable ? this.roster : null;
  }

  subscribe(
    _routes: ConnectorRouteConfig[],
    _confirmations: ConfirmationSubscription[],
    onEvent: (event: Event) => void,
    _onClose: (reason: string) => void,
  ): void {
    this.onEvent = onEvent;
  }
}

class GroupListingRelayFactory implements RelayConnectionFactory {
  connectCalls = 0;
  closed = false;

  constructor(private readonly groups: RelayGroup[]) {}

  async connect(): Promise<RelayConnection> {
    this.connectCalls += 1;
    const factory = this;
    return {
      close() {
        factory.closed = true;
      },
      async hasEvent() {
        return false;
      },
      async listGroups() {
        return factory.groups;
      },
      async publish() {},
      async readRoster() {
        return new Map();
      },
      subscribe() {},
    };
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
