import { createHash, randomBytes, randomUUID } from "node:crypto";

import { PgBoss } from "pg-boss";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabasePool,
  getDatabaseConnectionOptions,
} from "../db/pool";
import { BRIDGE_DELIVERY_QUEUE, configureQueues } from "../jobs/queues";
import {
  getOpenHubMembership,
  ingestBridgeMessage,
  joinOpenHub,
  listActiveConnectorConfigs,
  updateOpenHubSettings,
} from "./store";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const homeHost = "featured.buzzrouter.test";

describeDatabase("open-hub PostgreSQL integration", () => {
  let pool: Pool;
  let boss: PgBoss;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.BUZZROUTER_HOME_COMMUNITY_HOST = homeHost;
    pool = createDatabasePool();
    boss = new PgBoss(getDatabaseConnectionOptions("buzzrouter-hub-tests"));
    await boss.start();
    await configureQueues(boss);
  });

  beforeEach(async () => {
    await boss.deleteAllJobs(BRIDGE_DELIVERY_QUEUE);
    await pool.query(`
      TRUNCATE
        bridge_channel_handoffs,
        bridge_event_mappings,
        bridge_deliveries,
        bridge_messages,
        shared_channel_endpoints,
        shared_channels,
        connection_owner_sessions,
        connection_install_tokens,
        community_connections,
        communities,
        community_candidates
      CASCADE
    `);
  });

  afterAll(async () => {
    delete process.env.BUZZROUTER_HOME_COMMUNITY_HOST;
    await boss?.stop();
    await pool?.end();
  });

  it("creates one hub with bidirectional defaults and one endpoint per community", async () => {
    await createConnectedCommunity(pool, "home", homeHost);
    const first = await createConnectedCommunity(pool, "first");
    const second = await createConnectedCommunity(pool, "second");

    const firstMembership = await joinOpenHub(pool, {
      communityId: first.communityId,
      localChannelId: "first-general",
      localChannelName: "general",
      ownerPubkey: first.ownerPubkey,
    });
    const secondMembership = await joinOpenHub(pool, {
      communityId: second.communityId,
      localChannelId: "second-general",
      localChannelName: "general",
      ownerPubkey: second.ownerPubkey,
    });

    expect(secondMembership.sharedChannelId).toBe(firstMembership.sharedChannelId);
    expect(secondMembership).toMatchObject({
      filterList: [],
      filterMode: "everyone_except",
      receives: true,
      sends: true,
    });
    const rows = await pool.query<{ mode: string; role: string }>(`
      SELECT channels.mode, endpoints.role
      FROM shared_channels AS channels
      JOIN shared_channel_endpoints AS endpoints
        ON endpoints.shared_channel_id = channels.id
    `);
    expect(new Set(rows.rows.map((row) => row.mode))).toEqual(new Set(["hub"]));
    expect(new Set(rows.rows.map((row) => row.role))).toEqual(
      new Set(["participant"]),
    );
    expect(rows.rows).toHaveLength(3);
  });

  it("models a private pair as only_these with one selected community", async () => {
    await createConnectedCommunity(pool, "home", homeHost);
    const first = await createConnectedCommunity(pool, "first");
    const second = await createConnectedCommunity(pool, "second");
    await join(first, "first-general");
    await join(second, "second-general");

    const updated = await updateOpenHubSettings(pool, {
      communityId: first.communityId,
      filterList: [second.communityId],
      filterMode: "only_these",
      ownerPubkey: first.ownerPubkey,
      receives: true,
      sends: true,
    });

    expect(updated.filterMode).toBe("only_these");
    expect(updated.filterList).toEqual([second.communityId]);
  });

  it("changes the hub route to another local channel without creating a second endpoint", async () => {
    await createConnectedCommunity(pool, "home", homeHost);
    const member = await createConnectedCommunity(pool, "member");
    const original = await join(member, "member-general");

    const updated = await updateOpenHubSettings(pool, {
      communityId: member.communityId,
      filterList: original.filterList,
      filterMode: original.filterMode,
      localChannelId: "member-builders",
      localChannelName: "builders",
      ownerPubkey: member.ownerPubkey,
      receives: original.receives,
      sends: original.sends,
    });

    expect(updated).toMatchObject({
      endpointId: original.endpointId,
      localChannelId: "member-builders",
      localChannelName: "builders",
    });
    const configs = await listActiveConnectorConfigs(pool);
    expect(
      configs.find((config) => config.communityId === member.communityId)?.routes,
    ).toEqual([
      expect.objectContaining({
        localChannelId: "member-builders",
        sourceEndpointId: original.endpointId,
      }),
    ]);
  });

  it("fans out into independent durable jobs after receive filters", async () => {
    await createConnectedCommunity(pool, "home", homeHost);
    const source = await createConnectedCommunity(pool, "source");
    const allowed = await createConnectedCommunity(pool, "allowed");
    const muted = await createConnectedCommunity(pool, "muted");
    const sourceMembership = await join(source, "source-general");
    await join(allowed, "allowed-general");
    await join(muted, "muted-general");

    await updateOpenHubSettings(pool, {
      communityId: source.communityId,
      filterList: [allowed.communityId],
      filterMode: "only_these",
      ownerPubkey: source.ownerPubkey,
      receives: true,
      sends: true,
    });
    await updateOpenHubSettings(pool, {
      communityId: allowed.communityId,
      filterList: [source.communityId],
      filterMode: "only_these",
      ownerPubkey: allowed.ownerPubkey,
      receives: true,
      sends: true,
    });
    await updateOpenHubSettings(pool, {
      communityId: muted.communityId,
      filterList: [],
      filterMode: "everyone_except",
      ownerPubkey: muted.ownerPubkey,
      receives: false,
      sends: true,
    });

    const sourceEventId = randomBytes(32).toString("hex");
    const messageId = randomUUID();
    const result = await ingestBridgeMessage(pool, boss, {
      body: "Hello, hub.",
      bodySha256: sha256("Hello, hub."),
      messageId,
      sharedChannelId: sourceMembership.sharedChannelId,
      signedEvent: { id: sourceEventId, kind: 9 },
      sourceActorName: "Franz",
      sourceActorPubkey: randomBytes(32).toString("hex"),
      sourceCreatedAt: Math.floor(Date.now() / 1_000),
      sourceEndpointId: sourceMembership.endpointId,
      sourceEventId,
    });

    // The source's one-community allowlist makes this a private pair. Home is
    // not a destination even though it receives by default; muted is also off.
    expect(result.deliveryIds).toHaveLength(1);
    const outcomes = await getOpenHubMembership(
      pool,
      source.communityId,
      source.ownerPubkey,
    );
    expect(outcomes.recentOutcomes).toHaveLength(1);
    expect(outcomes.recentOutcomes.every((item) => item.state === "queued"))
      .toBe(true);

    const duplicate = await ingestBridgeMessage(pool, boss, {
      body: "Hello, hub.",
      bodySha256: sha256("Hello, hub."),
      messageId: randomUUID(),
      sharedChannelId: sourceMembership.sharedChannelId,
      signedEvent: { id: sourceEventId, kind: 9 },
      sourceActorName: "Franz",
      sourceActorPubkey: randomBytes(32).toString("hex"),
      sourceCreatedAt: Math.floor(Date.now() / 1_000),
      sourceEndpointId: sourceMembership.endpointId,
      sourceEventId,
    });
    expect(duplicate.created).toBe(false);
    expect(new Set(duplicate.deliveryIds)).toEqual(new Set(result.deliveryIds));
  });

  // This is the case that shipped broken. Unit tests covered the parser and
  // the projection, so both were green while the thing the user typed went
  // nowhere. Only an ingest-to-delivery assertion catches that.
  it("delivers an addressed message to exactly the addressed community", async () => {
    await createConnectedCommunity(pool, "home", homeHost);
    const source = await createConnectedCommunity(pool, "source");
    const wanted = await createConnectedCommunity(pool, "wanted");
    const bystander = await createConnectedCommunity(pool, "bystander");
    const sourceMembership = await join(source, "source-general");
    await join(wanted, "wanted-general");
    await join(bystander, "bystander-general");

    // Joining assigns the handle an author would address, derived from host.
    const slug = await pool.query<{ slug: string }>(
      "SELECT slug FROM communities WHERE id = $1",
      [wanted.communityId],
    );
    expect(slug.rows[0]?.slug).toBe("wanted");

    const sourceEventId = randomBytes(32).toString("hex");
    const result = await ingestBridgeMessage(pool, boss, {
      body: "routed payload",
      bodySha256: sha256("routed payload"),
      destinationCommunityId: wanted.communityId,
      messageId: randomUUID(),
      sharedChannelId: sourceMembership.sharedChannelId,
      signedEvent: { id: sourceEventId, kind: 9 },
      sourceActorPubkey: randomBytes(32).toString("hex"),
      sourceCreatedAt: Math.floor(Date.now() / 1_000),
      sourceEndpointId: sourceMembership.endpointId,
      sourceEventId,
    });

    // One delivery, not one per participant: routing, not broadcast.
    expect(result.deliveryIds).toHaveLength(1);
    const destination = await pool.query<{ community_id: string }>(
      `
        SELECT endpoints.community_id
        FROM bridge_deliveries AS deliveries
        JOIN shared_channel_endpoints AS endpoints
          ON endpoints.id = deliveries.destination_endpoint_id
        WHERE deliveries.id = $1
      `,
      [result.deliveryIds[0]],
    );
    expect(destination.rows[0]?.community_id).toBe(wanted.communityId);
  });

  it("removes a sends-off endpoint from connector subscriptions", async () => {
    await createConnectedCommunity(pool, "home", homeHost);
    const member = await createConnectedCommunity(pool, "member");
    await join(member, "member-general");
    await updateOpenHubSettings(pool, {
      communityId: member.communityId,
      filterList: [],
      filterMode: "everyone_except",
      ownerPubkey: member.ownerPubkey,
      receives: true,
      sends: false,
    });

    const configs = await listActiveConnectorConfigs(pool);
    expect(
      configs.find((config) => config.communityId === member.communityId)?.routes,
    ).toEqual([]);
  });

  async function join(
    community: CommunityFixture,
    channelId: string,
  ) {
    return joinOpenHub(pool, {
      communityId: community.communityId,
      localChannelId: channelId,
      localChannelName: "general",
      ownerPubkey: community.ownerPubkey,
    });
  }
});

interface CommunityFixture {
  communityId: string;
  ownerPubkey: string;
}

async function createConnectedCommunity(
  pool: Pool,
  marker: string,
  host = `${marker}.example.com`,
): Promise<CommunityFixture> {
  const ownerPubkey = createHash("sha256").update(`owner:${marker}`).digest("hex");
  const candidate = await pool.query<{ id: string }>(
    `
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [`wss://${host}`, host],
  );
  const community = await pool.query<{ id: string }>(
    `
      INSERT INTO communities (
        candidate_id, claim_state, owner_pubkey, display_name
      )
      VALUES ($1, 'admin_verified', $2, $3)
      RETURNING id
    `,
    [candidate.rows[0].id, ownerPubkey, marker],
  );
  await pool.query(
    `
      INSERT INTO community_connections (
        community_id, relay_url_snapshot, bridge_pubkey,
        encrypted_private_key, private_key_nonce, private_key_auth_tag,
        wrapping_key_version, state, health, activated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 1, 'active', 'healthy', now())
    `,
    [
      community.rows[0].id,
      `wss://${host}`,
      createHash("sha256").update(`bridge:${marker}`).digest("hex"),
      Buffer.alloc(32, 3),
      Buffer.alloc(12, 3),
      Buffer.alloc(16, 3),
    ],
  );
  return { communityId: community.rows[0].id, ownerPubkey };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
