import { randomBytes, randomUUID } from "node:crypto";

import type { Event } from "nostr-tools/core";
import { getPublicKey } from "nostr-tools/pure";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabasePool } from "../db/pool";
import type {
  RelayConnection,
  RelayConnectionFactory,
} from "./connector";
import {
  createDedicatedChannel,
  getChannelHandoff,
} from "./channel-handoff";
import { encryptConnectorPrivateKey } from "./store";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const wrappingKey = Buffer.alloc(32, 7);
const wrappingKeys = { getKey: async () => wrappingKey };

describeDatabase("bridge channel ownership handoff", () => {
  let pool: Pool;

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    pool ??= createDatabasePool();
    await pool.query(`
      TRUNCATE
        bridge_channel_handoffs,
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

  it("creates the owner-named channel and hands ownership to the relay owner", async () => {
    const community = await createConnectedCommunity(pool, "alpha");
    const relay = new RecordingRelay(community.ownerPubkey);
    relay.rosterRoles.set("0".repeat(64), "admin");
    const idempotencyKey = `idem-${randomUUID()}`;

    const result = await createDedicatedChannel(
      pool,
      {
        communityId: community.communityId,
        idempotencyKey,
        ownerPubkey: community.ownerPubkey,
        channelName: "Beta Collective",
      },
      wrappingKeys,
      new SingleRelayFactory(relay),
    );

    // The owner-entered name is retained. The id must be a UUID: Buzz parses
    // the `h` tag as one and silently substitutes its own id otherwise, which
    // leaves every later 9000 addressing a channel that does not exist.
    expect(result.channelName).toBe("Beta Collective");
    expect(result.channelId).toMatch(UUID_PATTERN);

    const create = relay.byKind(9_007);
    expect(create).toHaveLength(1);
    expect(tag(create[0], "h")?.[1]).toBe(result.channelId);
    expect(tag(create[0], "name")?.[1]).toBe("Beta Collective");

    // Ownership transfers to the relay owner, then the bot steps down to member.
    const puts = relay.byKind(9_000);
    expect(puts).toHaveLength(2);
    expect(tag(puts[0], "p")?.[1]).toBe(community.ownerPubkey);
    expect(tag(puts[1], "p")?.[1]).toBe(community.bridgePubkey);

    // What the relay actually stored — the roles ride in `role` tags, so a
    // promote that only fills the `p` tag's third slot would land here as
    // "member" and leave the channel ownerless.
    expect(relay.memberRoles.get(result.channelId)).toEqual(
      new Map([
        [community.ownerPubkey, "owner"],
        [community.bridgePubkey, "member"],
      ]),
    );

    const handoff = await getChannelHandoff(pool, {
      idempotencyKey,
      requesterPubkey: community.ownerPubkey,
    });
    expect(handoff?.state).toBe("completed");

    // A completed replay returns from the journal without decrypting a key or
    // connecting to the relay again.
    await expect(
      createDedicatedChannel(
        pool,
        {
          communityId: community.communityId,
          idempotencyKey,
          ownerPubkey: community.ownerPubkey,
          channelName: "Beta Collective",
        },
        {
          getKey: async () => {
            throw new Error("must not read key");
          },
        },
        {
          connect: async () => {
            throw new Error("must not connect");
          },
        },
      ),
    ).resolves.toEqual(result);
  });

  it("adds requested members as members while the bridge still owns the channel", async () => {
    const community = await createConnectedCommunity(pool, "members");
    const relay = new RecordingRelay(community.ownerPubkey);
    const requester = randomBytes(32).toString("hex");

    const result = await createDedicatedChannel(
      pool,
      {
        communityId: community.communityId,
        idempotencyKey: `idem-${randomUUID()}`,
        ownerPubkey: community.ownerPubkey,
        channelName: "connect-peer",
        members: [requester],
      },
      wrappingKeys,
      new SingleRelayFactory(relay),
    );

    // The requester lands as a plain member (via a `role` tag, so it is not left
    // at the default), alongside the promoted owner and the demoted bridge.
    expect(relay.memberRoles.get(result.channelId)).toEqual(
      new Map([
        [community.ownerPubkey, "owner"],
        [requester, "member"],
        [community.bridgePubkey, "member"],
      ]),
    );

    // The requester was added BEFORE the bridge demoted itself — i.e. while the
    // bridge was still owner and could issue 9000. The demote is always last.
    const puts = relay.byKind(9_000);
    const demoteIndex = puts.findIndex(
      (event) =>
        tag(event, "p")?.[1] === community.bridgePubkey &&
        tag(event, "p")?.[2] === "member",
    );
    const requesterIndex = puts.findIndex(
      (event) => tag(event, "p")?.[1] === requester,
    );
    expect(requesterIndex).toBeGreaterThanOrEqual(0);
    expect(requesterIndex).toBeLessThan(demoteIndex);
  });

  it("retries the handoff after a simulated promotion failure", async () => {
    const community = await createConnectedCommunity(pool, "gamma");
    const relay = new RecordingRelay(community.ownerPubkey);
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
          channelName: "Delta",
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
    // against the SAME channel — no second channel is created. The journal is
    // authoritative even if the relay roster is temporarily unavailable.
    relay.failPromote = false;
    relay.rosterAvailable = false;
    const result = await createDedicatedChannel(
      pool,
      {
        communityId: community.communityId,
        idempotencyKey,
        ownerPubkey: community.ownerPubkey,
        channelName: "Delta",
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

  it("does not create a channel when the relay owner roster cannot be verified", async () => {
    const community = await createConnectedCommunity(pool, "unverified");
    const relay = new RecordingRelay(community.ownerPubkey);
    relay.rosterAvailable = false;

    await expect(
      createDedicatedChannel(
        pool,
        {
          communityId: community.communityId,
          idempotencyKey: `idem-${randomUUID()}`,
          ownerPubkey: community.ownerPubkey,
          channelName: "Must Not Exist",
        },
        wrappingKeys,
        new SingleRelayFactory(relay),
      ),
    ).rejects.toMatchObject({ code: "channel_owner_unavailable" });

    expect(relay.published).toHaveLength(0);
  });

  it("resumes at bridge demotion after a demotion failure", async () => {
    const community = await createConnectedCommunity(pool, "demotion");
    const relay = new RecordingRelay(community.ownerPubkey);
    relay.failDemote = true;
    const idempotencyKey = `idem-${randomUUID()}`;

    await expect(
      createDedicatedChannel(
        pool,
        {
          communityId: community.communityId,
          idempotencyKey,
          ownerPubkey: community.ownerPubkey,
          channelName: "Resume Demotion",
        },
        wrappingKeys,
        new SingleRelayFactory(relay),
      ),
    ).rejects.toMatchObject({ code: "channel_handoff_incomplete" });

    const stalled = await getChannelHandoff(pool, {
      idempotencyKey,
      requesterPubkey: community.ownerPubkey,
    });
    expect(stalled?.state).toBe("handed_off");
    expect(relay.byKind(9_007)).toHaveLength(1);
    expect(relay.byKind(9_000)).toHaveLength(1);

    relay.failDemote = false;
    relay.rosterAvailable = false;
    await expect(
      createDedicatedChannel(
        pool,
        {
          communityId: community.communityId,
          idempotencyKey,
          ownerPubkey: community.ownerPubkey,
          channelName: "Resume Demotion",
        },
        wrappingKeys,
        new SingleRelayFactory(relay),
      ),
    ).resolves.toMatchObject({ channelId: stalled?.channelId });

    expect(relay.byKind(9_007)).toHaveLength(1);
    expect(relay.byKind(9_000)).toHaveLength(2);
    expect(tag(relay.byKind(9_000).at(-1)!, "p")).toEqual([
      "p",
      community.bridgePubkey,
      "member",
    ]);
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `h` tag as Buzz reads it: a UUID, or nothing at all. */
function uuidHTag(event: Event): string | undefined {
  const value = event.tags.find((entry) => entry[0] === "h")?.[1];
  return value && UUID_PATTERN.test(value) ? value : undefined;
}

/**
 * A relay double that records every published event and can be told to reject
 * the ownership-promotion publish, so the create-then-fail-to-hand-off path is
 * exercised deterministically.
 *
 * It enforces the two rules Buzz enforces that a permissive double used to hide
 * (see `crates/buzz-relay/src/handlers/ingest.rs` + `side_effects.rs`):
 *   - the `h` tag is parsed as a UUID, and kind 9000 is refused outright when it
 *     does not resolve to an existing channel ("channel-scoped events must
 *     include an h tag");
 *   - the role comes from a `role` tag, so `["p", pubkey, role]` alone leaves a
 *     new member at `member`.
 * `memberRoles` therefore records what the relay would really have stored.
 */
class RecordingRelay implements RelayConnection {
  readonly published: Event[] = [];
  readonly rosterRoles = new Map<string, string>();
  /** channelId -> pubkey -> role, as the relay would have stored it. */
  readonly memberRoles = new Map<string, Map<string, string>>();
  failDemote = false;
  failPromote = false;
  rosterAvailable = true;

  constructor(private readonly ownerPubkey: string) {
    this.rosterRoles.set(ownerPubkey, "owner");
  }

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
    if (
      this.failDemote &&
      event.kind === 9_000 &&
      put?.[1] !== this.ownerPubkey &&
      put?.[2] === "member"
    ) {
      throw new Error("relay rejected the demotion");
    }
    const channelId = uuidHTag(event);
    if (event.kind === 9_007) {
      // A non-UUID `h` is dropped and the relay invents its own id, so the
      // caller never learns where the channel landed.
      this.memberRoles.set(channelId ?? randomUUID(), new Map());
    }
    if (event.kind === 9_000) {
      const members = channelId ? this.memberRoles.get(channelId) : undefined;
      if (!members) {
        throw new Error(
          "invalid: channel-scoped events must include an h tag",
        );
      }
      const target = put?.[1];
      if (!target) throw new Error("invalid: missing p tag");
      const role = event.tags.find((entry) => entry[0] === "role")?.[1];
      members.set(target, role ?? members.get(target) ?? "member");
    }
    this.published.push(event);
  }

  async readGroupMembers(): Promise<Set<string> | null> {
    return new Set();
  }

  async readRoster(): Promise<Set<string> | null> {
    return new Set([this.ownerPubkey]);
  }

  async readRosterRoles(): Promise<Map<string, string> | null> {
    return this.rosterAvailable
      ? new Map(this.rosterRoles)
      : null;
  }

  byKind(kind: number): Event[] {
    return this.published.filter((event) => event.kind === kind);
  }

  subscribe(): void {}
}

class SingleRelayFactory implements RelayConnectionFactory {
  constructor(private readonly relay: RelayConnection) {}

  async connect(): Promise<RelayConnection> {
    return this.relay;
  }
}
