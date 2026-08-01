import { randomBytes, randomUUID } from "node:crypto";

import type { Event } from "nostr-tools/core";
import { getPublicKey } from "nostr-tools/pure";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabasePool } from "../db/pool";
import type {
  ConfirmationSubscription,
  CommunityRoster,
  RelayConnection,
  RelayConnectionFactory,
} from "./connector";
import {
  createDedicatedChannel,
  getChannelHandoff,
} from "./channel-handoff";
import {
  createSharedChannel,
  encryptConnectorPrivateKey,
  type ConnectorRouteConfig,
} from "./store";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const wrappingKey = Buffer.alloc(32, 7);
const wrappingKeys = { getKey: async () => wrappingKey };

describeDatabase("bridge channel-per-link handoff", () => {
  let pool: Pool;

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    pool ??= createDatabasePool();
    await pool.query(`
      TRUNCATE
        bridge_channel_handoffs,
        shared_channel_audit_events,
        shared_channel_confirmations,
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
    await pool?.end();
  });

  it("creates a channel named after the peer and hands ownership to the requester", async () => {
    const community = await createConnectedCommunity(pool, "alpha");
    const relay = new RecordingRelay();
    const idempotencyKey = `idem-${randomUUID()}`;

    const result = await createDedicatedChannel(
      pool,
      {
        communityId: community.communityId,
        idempotencyKey,
        ownerPubkey: community.ownerPubkey,
        peerName: "Beta Collective",
      },
      wrappingKeys,
      new SingleRelayFactory(relay),
    );

    // Named after the peer, self-describing id derived from that name.
    expect(result.channelName).toBe("Beta Collective");
    expect(result.channelId).toMatch(/^beta-collective-[0-9a-f]{8}$/);

    const create = relay.byKind(9_007);
    expect(create).toHaveLength(1);
    expect(tag(create[0], "h")?.[1]).toBe(result.channelId);
    expect(tag(create[0], "name")?.[1]).toBe("Beta Collective");

    // Ownership transferred to the requester, then the bot steps down to member.
    const puts = relay.byKind(9_000);
    expect(puts).toHaveLength(2);
    expect(tag(puts[0], "p")).toEqual([
      "p",
      community.ownerPubkey,
      "owner",
    ]);
    expect(tag(puts[1], "p")).toEqual([
      "p",
      community.bridgePubkey,
      "member",
    ]);

    // The bot must NOT end as the owner of a channel in someone else's community.
    const botFinalRole = relay
      .byKind(9_000)
      .filter((event) => tag(event, "p")?.[1] === community.bridgePubkey)
      .at(-1);
    expect(tag(botFinalRole!, "p")?.[2]).toBe("member");

    const handoff = await getChannelHandoff(pool, {
      idempotencyKey,
      requesterPubkey: community.ownerPubkey,
    });
    expect(handoff?.state).toBe("completed");
  });

  it("retries the handoff after a simulated promotion failure", async () => {
    const community = await createConnectedCommunity(pool, "gamma");
    const relay = new RecordingRelay();
    relay.failPromote = true;
    const idempotencyKey = `idem-${randomUUID()}`;

    // First attempt: creation succeeds, promotion fails.
    await expect(
      createDedicatedChannel(
        pool,
        {
          communityId: community.communityId,
          idempotencyKey,
          ownerPubkey: community.ownerPubkey,
          peerName: "Delta",
        },
        wrappingKeys,
        new SingleRelayFactory(relay),
      ),
    ).rejects.toMatchObject({ code: "channel_handoff_incomplete" });

    // The channel exists; the bot still owns it (no demote yet).
    expect(relay.byKind(9_007)).toHaveLength(1);
    const stalled = await getChannelHandoff(pool, {
      idempotencyKey,
      requesterPubkey: community.ownerPubkey,
    });
    expect(stalled?.state).toBe("created");
    expect(stalled?.lastError).toBe("channel_handoff_incomplete");
    const createdChannelId = stalled!.channelId;

    // Retry: the relay now accepts the promotion, so the handoff completes
    // against the SAME channel — no second channel is created.
    relay.failPromote = false;
    const result = await createDedicatedChannel(
      pool,
      {
        communityId: community.communityId,
        idempotencyKey,
        ownerPubkey: community.ownerPubkey,
        peerName: "Delta",
      },
      wrappingKeys,
      new SingleRelayFactory(relay),
    );

    expect(result.channelId).toBe(createdChannelId);
    expect(relay.byKind(9_007)).toHaveLength(1); // still exactly one create
    const puts = relay.byKind(9_000);
    expect(tag(puts.at(-2)!, "p")).toEqual([
      "p",
      community.ownerPubkey,
      "owner",
    ]);
    expect(tag(puts.at(-1)!, "p")).toEqual([
      "p",
      community.bridgePubkey,
      "member",
    ]);
    const completed = await getChannelHandoff(pool, {
      idempotencyKey,
      requesterPubkey: community.ownerPubkey,
    });
    expect(completed?.state).toBe("completed");
  });

  it("still allows picking an existing channel, and rejects an already-routed one with a product error", async () => {
    const source = await createConnectedCommunity(pool, "epsilon");
    const destination = await createVerifiedCommunity(pool, "zeta");

    // Picking an existing channel by id still creates the proposal.
    const proposal = await createSharedChannel(pool, {
      destinationCommunityId: destination.communityId,
      idempotencyKey: `idem-${randomUUID()}`,
      ownerPubkey: source.ownerPubkey,
      proposedName: "shared-desk",
      purpose: "Coordinate across communities.",
      sourceChannelId: "general",
      sourceChannelName: "general",
      sourceCommunityId: source.communityId,
    });
    expect(proposal.state).toBe("proposed");

    // Reusing that same, now-routed channel fails as a clear product error —
    // NOT a raw unique-constraint violation (which would surface as a 500).
    await expect(
      createSharedChannel(pool, {
        destinationCommunityId: destination.communityId,
        idempotencyKey: `idem-${randomUUID()}`,
        ownerPubkey: source.ownerPubkey,
        proposedName: "shared-desk-2",
        purpose: "Second route on the same channel.",
        sourceChannelId: "general",
        sourceChannelName: "general",
        sourceCommunityId: source.communityId,
      }),
    ).rejects.toMatchObject({ code: "channel_already_routed", status: 409 });
  });
});

interface CommunityFixture {
  bridgePubkey: string;
  communityId: string;
  ownerPubkey: string;
  relayUrl: string;
}

async function createVerifiedCommunity(
  pool: Pool,
  name: string,
): Promise<CommunityFixture> {
  const ownerPubkey = randomBytes(32).toString("hex");
  const relayUrl = `wss://${name}-${randomUUID()}.example.com`;
  const candidate = await pool.query<{ id: string }>(
    `
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [relayUrl, `${name}.example.com`],
  );
  const community = await pool.query<{ id: string }>(
    `
      INSERT INTO communities (
        candidate_id, claim_state, owner_pubkey, open_to_shared_channels
      )
      VALUES ($1, 'admin_verified', $2, true)
      RETURNING id
    `,
    [candidate.rows[0].id, ownerPubkey],
  );
  return {
    bridgePubkey: "",
    communityId: community.rows[0].id,
    ownerPubkey,
    relayUrl,
  };
}

async function createConnectedCommunity(
  pool: Pool,
  name: string,
): Promise<CommunityFixture> {
  const fixture = await createVerifiedCommunity(pool, name);
  const bridgeKey = randomBytes(32);
  const bridgePubkey = getPublicKey(bridgeKey);
  const encrypted = encryptConnectorPrivateKey(
    bridgeKey,
    wrappingKey,
    fixture.communityId,
  );
  await pool.query(
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
        activated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 1, 'active', 'healthy', now())
    `,
    [
      fixture.communityId,
      fixture.relayUrl,
      bridgePubkey,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.authTag,
    ],
  );
  return { ...fixture, bridgePubkey };
}

function tag(event: Event, name: string): string[] | undefined {
  return event.tags.find((entry) => entry[0] === name);
}

/**
 * A relay double that records every published event and can be told to reject
 * the ownership-promotion publish, so the create-then-fail-to-hand-off path is
 * exercised deterministically.
 */
class RecordingRelay implements RelayConnection {
  readonly published: Event[] = [];
  failPromote = false;

  close(): void {}

  async hasEvent(eventId: string): Promise<boolean> {
    return this.published.some((event) => event.id === eventId);
  }

  async listGroups(): Promise<never[]> {
    return [];
  }

  async publish(event: Event): Promise<void> {
    const put = event.tags.find((entry) => entry[0] === "p");
    if (this.failPromote && event.kind === 9_000 && put?.[2] === "owner") {
      throw new Error("relay rejected the promotion");
    }
    this.published.push(event);
  }

  async readRoster(): Promise<CommunityRoster | null> {
    return new Map();
  }

  byKind(kind: number): Event[] {
    return this.published.filter((event) => event.kind === kind);
  }

  subscribe(
    _routes: ConnectorRouteConfig[],
    _confirmations: ConfirmationSubscription[],
    _onEvent: (event: Event) => void,
    _onClose: (reason: string) => void,
  ): void {}
}

class SingleRelayFactory implements RelayConnectionFactory {
  constructor(private readonly relay: RelayConnection) {}

  async connect(): Promise<RelayConnection> {
    return this.relay;
  }
}
