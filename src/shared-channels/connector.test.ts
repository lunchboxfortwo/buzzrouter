import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Event } from "nostr-tools/core";
import type { Relay } from "nostr-tools/relay";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "nostr-tools/pure";

import { parseMessageAddress } from "./addressing";
import {
  canonicalizeSourceEvent,
  hasBuzzRouterProjectionMarker,
} from "./bridge";
import {
  ConnectorSupervisor,
  isOperatedCommunityRelay,
  NostrRelayConnection,
  parseWrappingKeyFile,
  reconcileHomeCommunityMembers,
  undeliverableNotice,
  type RelayConnection,
} from "./connector";
import {
  encryptConnectorPrivateKey,
  homeCommunityChannelId,
} from "./store";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("NostrRelayConnection", () => {
  function fakeRelay(behavior: {
    challenge: boolean;
    rejectFirstPublish: boolean;
  }) {
    const state = { authCalls: 0, publishCalls: 0 };
    const relay = {
      async auth() {
        if (!behavior.challenge) {
          throw new Error("can't perform auth, no challenge was received");
        }
        state.authCalls += 1;
        return "";
      },
      async publish() {
        state.publishCalls += 1;
        if (behavior.rejectFirstPublish && state.publishCalls === 1) {
          throw new Error("auth-required: not authenticated");
        }
      },
    } as unknown as Relay;
    return { relay, state };
  }

  it("authenticates before publishing and retries an auth-required publish", async () => {
    const { relay, state } = fakeRelay({
      challenge: true,
      rejectFirstPublish: true,
    });
    const connection = new NostrRelayConnection(relay, randomBytes(32));

    await connection.authenticate();
    await connection.publish({ id: "e".repeat(64) } as never);

    expect(state.authCalls).toBe(2);
    expect(state.publishCalls).toBe(2);
  });

  it("treats a relay without a challenge as not requiring NIP-42", async () => {
    vi.useFakeTimers();
    try {
      const { relay, state } = fakeRelay({
        challenge: false,
        rejectFirstPublish: false,
      });
      const connection = new NostrRelayConnection(relay, randomBytes(32));

      const authenticated = connection.authenticate();
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(authenticated).resolves.toBeUndefined();
      await connection.publish({ id: "f".repeat(64) } as never);

      expect(state.authCalls).toBe(0);
      expect(state.publishCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not treat a pre-challenge auth failure as no-auth-required: it waits and succeeds once the challenge lands", async () => {
    vi.useFakeTimers();
    try {
      const state = { authCalls: 0, attempts: 0 };
      const relay = {
        async auth() {
          state.attempts += 1;
          // The challenge only lands after a couple of retries — mirrors a
          // real relay whose AUTH challenge arrives shortly after connect.
          if (state.attempts < 3) {
            throw new Error("can't perform auth, no challenge was received");
          }
          state.authCalls += 1;
          return "";
        },
      } as unknown as Relay;
      const connection = new NostrRelayConnection(relay, randomBytes(32));

      const authenticated = connection.authenticate();
      await vi.advanceTimersByTimeAsync(500);
      await expect(authenticated).resolves.toBeUndefined();

      expect(state.authCalls).toBe(1);
      expect(state.attempts).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up quietly after the deadline when the relay never challenges, without hanging", async () => {
    vi.useFakeTimers();
    try {
      const { relay, state } = fakeRelay({
        challenge: false,
        rejectFirstPublish: false,
      });
      const connection = new NostrRelayConnection(relay, randomBytes(32));

      const authenticated = connection.authenticate();
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(authenticated).resolves.toBeUndefined();

      expect(state.authCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("NostrRelayConnection.listGroups", () => {
  function groupEvent(id: string, name?: string): Event {
    const tags = [["d", id]];
    if (name !== undefined) tags.push(["name", name]);
    return { kind: 39_000, tags } as unknown as Event;
  }

  it("returns deduplicated NIP-29 groups, falling back to the id for a missing name", async () => {
    const relay = {
      async auth() {
        return "";
      },
      subscribe(
        _filters: unknown,
        params: {
          onevent: (event: Event) => void;
          oneose: () => void;
        },
      ) {
        params.onevent(groupEvent("group-b", "Beta"));
        params.onevent(groupEvent("group-a", "Alpha"));
        params.onevent(groupEvent("group-a", "Alpha (renamed)"));
        params.onevent(groupEvent("group-c"));
        params.oneose();
        return { close() {} };
      },
    } as unknown as Relay;
    const connection = new NostrRelayConnection(relay, randomBytes(32));

    await expect(connection.listGroups()).resolves.toEqual([
      { id: "group-b", name: "Beta" },
      { id: "group-a", name: "Alpha (renamed)" },
      { id: "group-c", name: "group-c" },
    ]);
  });

  it("re-authenticates and retries once when a listing is closed auth-required", async () => {
    const state = { authCalls: 0, subscribeCalls: 0 };
    const relay = {
      async auth() {
        state.authCalls += 1;
        return "";
      },
      subscribe(
        _filters: unknown,
        params: {
          onclose: (reason: string) => void;
          onevent: (event: Event) => void;
          oneose: () => void;
        },
      ) {
        state.subscribeCalls += 1;
        if (state.subscribeCalls === 1) {
          params.onclose("auth-required: authentication needed");
        } else {
          params.onevent(groupEvent("group-a", "Alpha"));
          params.oneose();
        }
        return { close() {} };
      },
    } as unknown as Relay;
    const connection = new NostrRelayConnection(relay, randomBytes(32));

    await expect(connection.listGroups()).resolves.toEqual([
      { id: "group-a", name: "Alpha" },
    ]);
    expect(state.authCalls).toBe(1);
    expect(state.subscribeCalls).toBe(2);
  });
});

describe("NostrRelayConnection profile names", () => {
  it("reads display_name from kind-0 and caches it by pubkey", async () => {
    const pubkey = "a".repeat(64);
    let subscriptions = 0;
    const relay = {
      connected: true,
      subscribe(
        _filters: unknown,
        params: {
          oneose: () => void;
          onevent: (event: Event) => void;
        },
      ) {
        subscriptions += 1;
        params.onevent({
          content: JSON.stringify({ display_name: "Franz" }),
          created_at: 1,
          kind: 0,
          pubkey,
          tags: [],
        } as unknown as Event);
        params.oneose();
        return { close() {} };
      },
    } as unknown as Relay;
    const connection = new NostrRelayConnection(relay, randomBytes(32));

    await expect(connection.getProfileName(pubkey)).resolves.toBe("Franz");
    await expect(connection.getProfileName(pubkey)).resolves.toBe("Franz");
    expect(subscriptions).toBe(1);
  });
});

describe("NostrRelayConnection relay-signed state", () => {
  function signedEvent(
    privateKey: Uint8Array,
    kind: number,
    tags: string[][],
  ): Event {
    return finalizeEvent(
      { content: "", created_at: 1, kind, tags },
      privateKey,
    );
  }

  function stateRelay(events: Event[]) {
    return {
      subscribe(
        _filters: unknown,
        params: {
          oneose: () => void;
          onevent: (event: Event) => void;
        },
      ) {
        for (const event of events) params.onevent(event);
        params.oneose();
        return { close() {} };
      },
    } as unknown as Relay;
  }

  function advertiseRelay(pubkey: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ self: pubkey }), { status: 200 }),
      ),
    );
  }

  it("accepts a cryptographically valid kind-13534 roster signed by NIP-11 self", async () => {
    const relayKey = generateSecretKey();
    const relayPubkey = getPublicKey(relayKey);
    advertiseRelay(relayPubkey);
    const event = signedEvent(relayKey, 13_534, [
      ["-"],
      ["member", "a".repeat(64), "member"],
      ["member", "b".repeat(64), "admin"],
    ]);
    const connection = new NostrRelayConnection(
      stateRelay([event]),
      generateSecretKey(),
      "wss://relay.buzzrouter.com",
    );

    await expect(connection.readRoster()).resolves.toEqual(
      new Set(["a".repeat(64), "b".repeat(64)]),
    );
    await expect(connection.readRosterRoles()).resolves.toEqual(
      new Map([
        ["a".repeat(64), "member"],
        ["b".repeat(64), "admin"],
      ]),
    );
  });

  it("fails closed when the newest roster signature is invalid", async () => {
    const relayKey = generateSecretKey();
    advertiseRelay(getPublicKey(relayKey));
    const valid = signedEvent(relayKey, 13_534, [
      ["member", "a".repeat(64), "member"],
    ]);
    const invalid = {
      ...(JSON.parse(JSON.stringify(valid)) as Event),
      created_at: 2,
      sig: `${valid.sig.slice(0, -1)}${valid.sig.endsWith("0") ? "1" : "0"}`,
    };
    const connection = new NostrRelayConnection(
      stateRelay([valid, invalid]),
      generateSecretKey(),
      "wss://relay.buzzrouter.com",
    );

    await expect(connection.readRoster()).resolves.toBeNull();
  });

  it("fails closed when NIP-11 does not advertise a valid relay identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ self: "not-a-pubkey" }), { status: 200 }),
      ),
    );
    const connection = new NostrRelayConnection(
      stateRelay([]),
      generateSecretKey(),
      "wss://relay.buzzrouter.com",
    );

    await expect(connection.readRoster()).resolves.toBeNull();
  });

  it("reads only the requested relay-signed kind-39002 member list", async () => {
    const relayKey = generateSecretKey();
    advertiseRelay(getPublicKey(relayKey));
    const event = signedEvent(relayKey, 39_002, [
      ["d", "general"],
      ["p", "c".repeat(64), "", "member"],
    ]);
    const connection = new NostrRelayConnection(
      stateRelay([event]),
      generateSecretKey(),
      "wss://relay.buzzrouter.com",
    );

    await expect(connection.readGroupMembers("general")).resolves.toEqual(
      new Set(["c".repeat(64)]),
    );
    await expect(connection.readGroupMembers("support")).resolves.toBeNull();
  });
});

describe("home-community membership reconciliation", () => {
  function fakeConnection(input: {
    groupMembers: Set<string> | null;
    roster: Set<string> | null;
  }): RelayConnection & { published: Event[] } {
    const published: Event[] = [];
    return {
      published,
      close() {},
      async getProfileName() {
        return null;
      },
      async hasEvent() {
        return false;
      },
      async listGroups() {
        return [];
      },
      async publish(event) {
        published.push(event);
        const target = event.tags.find((tag) => tag[0] === "p")?.[1];
        if (target) input.groupMembers?.add(target);
      },
      async readGroupMembers() {
        return input.groupMembers ? new Set(input.groupMembers) : null;
      },
      async readRoster() {
        return input.roster ? new Set(input.roster) : null;
      },
      async readRosterRoles() {
        return input.roster
          ? new Map([...input.roster].map((pubkey) => [pubkey, "member"]))
          : null;
      },
      subscribe() {},
    };
  }

  it("adds each missing relay member to general once with a signed kind-9000", async () => {
    const existing = "a".repeat(64);
    const missing = "b".repeat(64);
    const privateKey = generateSecretKey();
    const relay = fakeConnection({
      groupMembers: new Set([existing]),
      roster: new Set([existing, missing]),
    });

    await expect(
      reconcileHomeCommunityMembers(relay, privateKey),
    ).resolves.toBe(1);
    await expect(
      reconcileHomeCommunityMembers(relay, privateKey),
    ).resolves.toBe(0);

    expect(relay.published).toHaveLength(1);
    expect(relay.published[0]).toMatchObject({
      kind: 9_000,
      pubkey: getPublicKey(privateKey),
      tags: [
        ["h", "general"],
        ["p", missing],
        ["role", "member"],
      ],
    });
    expect(verifyEvent(relay.published[0])).toBe(true);
  });

  it("publishes nothing when either authoritative roster cannot be read", async () => {
    const privateKey = generateSecretKey();
    const missingRoster = fakeConnection({
      groupMembers: new Set(),
      roster: null,
    });
    const missingGroup = fakeConnection({
      groupMembers: null,
      roster: new Set(["a".repeat(64)]),
    });

    await expect(
      reconcileHomeCommunityMembers(missingRoster, privateKey),
    ).resolves.toBeNull();
    await expect(
      reconcileHomeCommunityMembers(missingGroup, privateKey),
    ).resolves.toBeNull();
    expect(missingRoster.published).toHaveLength(0);
    expect(missingGroup.published).toHaveLength(0);
  });

  it("stops before publishing when its supervisor session is cancelled", async () => {
    const relay = fakeConnection({
      groupMembers: new Set(),
      roster: new Set(["a".repeat(64)]),
    });

    await expect(
      reconcileHomeCommunityMembers(relay, generateSecretKey(), () => false),
    ).resolves.toBe(0);
    expect(relay.published).toHaveLength(0);
  });

  it("uses the configured production NIP-29 channel UUID", () => {
    const channelId = "d2cddea6-3224-43e8-bd45-0da26d95d378";
    vi.stubEnv("BUZZROUTER_HOME_CHANNEL_ID", channelId);
    expect(homeCommunityChannelId()).toBe(channelId);
  });

  it("gates reconciliation to the exact operated relay URL", () => {
    vi.stubEnv("BUZZROUTER_HOME_COMMUNITY_HOST", "relay.buzzrouter.com");
    vi.stubEnv("BUZZROUTER_HOME_RELAY_URL", "wss://relay.buzzrouter.com");
    expect(
      isOperatedCommunityRelay("wss://relay.buzzrouter.com"),
    ).toBe(true);
    expect(isOperatedCommunityRelay("ws://relay.buzzrouter.com")).toBe(false);
    expect(
      isOperatedCommunityRelay("wss://relay.buzzrouter.com:7447"),
    ).toBe(false);
    expect(
      isOperatedCommunityRelay("wss://relay.buzzrouter.com/alternate"),
    ).toBe(false);
    expect(
      isOperatedCommunityRelay("wss://relay.buzzrouter.com.evil.example"),
    ).toBe(false);
    expect(isOperatedCommunityRelay("wss://third-party.example")).toBe(false);
    expect(isOperatedCommunityRelay("not a relay URL")).toBe(false);
  });
});

describe("ConnectorSupervisor operated-community routing", () => {
  function supervisorHarness(relayUrl: string) {
    const privateKey = generateSecretKey();
    const wrappingKey = randomBytes(32);
    const communityId = "11111111-1111-4111-8111-111111111111";
    const encrypted = encryptConnectorPrivateKey(
      privateKey,
      wrappingKey,
      communityId,
    );
    const state = {
      connectCalls: 0,
      lockCalls: 0,
      readRosterCalls: 0,
      subscriptions: [] as Array<{
        onClose: (reason: string) => void;
        onEvent: (event: Event) => void;
        watchRoster: boolean;
      }>,
    };
    const pool = {
      async connect() {
        return {
          async query(sql: string) {
            if (sql.includes("pg_try_advisory_lock")) {
              state.lockCalls += 1;
              return { rows: [{ acquired: true }] };
            }
            return { rows: [{ pg_advisory_unlock: true }] };
          },
          release() {},
        };
      },
      async query(sql: string) {
        if (sql.includes("FROM community_connections")) {
          return {
            rows: [{
              bridge_pubkey: getPublicKey(privateKey),
              community_id: communityId,
              encrypted_private_key: encrypted.ciphertext,
              health: "healthy",
              id: "22222222-2222-4222-8222-222222222222",
              private_key_auth_tag: encrypted.authTag,
              private_key_nonce: encrypted.nonce,
              relay_url_snapshot: relayUrl,
              state: "active",
              wrapping_key_version: 1,
            }],
          };
        }
        return { rows: [] };
      },
    };
    const relayFactory = {
      async connect() {
        state.connectCalls += 1;
        const relay: RelayConnection = {
          close() {},
          async hasEvent() { return false; },
          async listGroups() { return []; },
          async publish() {},
          async readGroupMembers() { return new Set(); },
          async readRoster() {
            state.readRosterCalls += 1;
            return new Set();
          },
          async readRosterRoles() { return new Map(); },
          subscribe(_routes, watchRoster, onEvent, onClose) {
            state.subscriptions.push({ onClose, onEvent, watchRoster });
          },
        };
        return relay;
      },
    };
    const supervisor = new ConnectorSupervisor(
      pool as never,
      {} as never,
      { async getKey() { return wrappingKey; } },
      relayFactory,
    );
    return { state, supervisor };
  }

  // The backstop for a subscription that stops delivering while the socket
  // stays OPEN: that is indistinguishable from a quiet channel here, so
  // silence alone triggers a rebuild.
  it("rebuilds a subscription that has been silent too long", async () => {
    const { state, supervisor } = supervisorHarness("wss://third-party.example");
    await supervisor.start();
    expect(state.connectCalls).toBe(1);

    // Still inside the window: left alone.
    await supervisor.reconcile();
    expect(state.connectCalls).toBe(1);

    vi.setSystemTime(Date.now() + 120_000);
    await supervisor.reconcile();
    expect(state.connectCalls).toBe(2);
    expect(state.subscriptions).toHaveLength(2);
    await supervisor.stop();
  });

  it("leaves a session alone while events are still arriving", async () => {
    const { state, supervisor } = supervisorHarness("wss://third-party.example");
    await supervisor.start();
    vi.setSystemTime(Date.now() + 120_000);
    // An inbound event resets the idle clock, so this must NOT recycle.
    state.subscriptions[0].onEvent({
      content: "",
      created_at: 0,
      id: "a".repeat(64),
      kind: 9,
      pubkey: "b".repeat(64),
      sig: "c".repeat(128),
      tags: [],
    });
    await supervisor.reconcile();
    expect(state.connectCalls).toBe(1);
    await supervisor.stop();
  });

  it("never watches or reconciles a third-party relay", async () => {
    const { state, supervisor } = supervisorHarness("wss://third-party.example");
    await supervisor.start();
    expect(state.subscriptions[0]?.watchRoster).toBe(false);
    expect(state.lockCalls).toBe(0);
    expect(state.readRosterCalls).toBe(0);
    await supervisor.stop();
  });

  it("watches the operated roster and recreates a closed subscription", async () => {
    vi.stubEnv("BUZZROUTER_HOME_RELAY_URL", "wss://relay.buzzrouter.com");
    const { state, supervisor } = supervisorHarness(
      "wss://relay.buzzrouter.com",
    );
    await supervisor.start();
    await vi.waitFor(() => expect(state.readRosterCalls).toBe(1));
    expect(state.subscriptions[0]?.watchRoster).toBe(true);

    state.subscriptions[0].onClose("socket lost");
    await supervisor.reconcile();
    expect(state.connectCalls).toBe(2);
    expect(state.subscriptions).toHaveLength(2);
    await supervisor.stop();
  });
});

describe("ConnectorSupervisor addressed routing", () => {
  const SOURCE_COMMUNITY = "11111111-1111-4111-8111-111111111111";
  const DESTINATION_COMMUNITY = "22222222-2222-4222-8222-222222222222";
  const SOURCE_CONNECTION = "33333333-3333-4333-8333-333333333333";
  const DESTINATION_CONNECTION = "44444444-4444-4444-8444-444444444444";
  const SHARED_CHANNEL = "55555555-5555-4555-8555-555555555555";
  const SOURCE_ENDPOINT = "66666666-6666-4666-8666-666666666666";
  const SOURCE_RELAY = "wss://source.example";
  const DESTINATION_RELAY = "wss://destination.example";
  const ALICE = "a".repeat(64);
  const BOB = "b".repeat(64);

  /**
   * A supervisor holding a live session for both ends of one hub: the source
   * community whose channel is read, and the `@destination` community whose
   * roster answers `@destination/user`.
   *
   * The source relay is a store, not a pipe: everything posted to the bridged
   * channel is kept, and every (re)subscription replays what it holds from the
   * route's cursor. That is the behaviour that turned one bounce into a storm,
   * so a harness that only pushes live events cannot see the bug at all.
   */
  function routingHarness(
    options: {
      /** Clock cost of one profile read, for exercising the index deadline. */
      profileCostMs?: number;
      profiles?: Record<string, string | null>;
      rosterReadable?: boolean;
    } = {},
  ) {
    const wrappingKey = randomBytes(32);
    const keys = new Map([
      [SOURCE_CONNECTION, generateSecretKey()],
      [DESTINATION_CONNECTION, generateSecretKey()],
    ]);
    const connections = [
      {
        communityId: SOURCE_COMMUNITY,
        id: SOURCE_CONNECTION,
        relayUrl: SOURCE_RELAY,
      },
      {
        communityId: DESTINATION_COMMUNITY,
        id: DESTINATION_CONNECTION,
        relayUrl: DESTINATION_RELAY,
      },
    ];
    const state = {
      /** Everything the source relay stores for the bridged channel. */
      channelLog: [] as Event[],
      destinationLookups: [] as string[],
      /** Every attempt to claim a notice, whether or not it won. */
      noticeClaims: [] as string[],
      claimedNotices: new Set<string>(),
      profileReads: 0,
      published: [] as Event[],
      rosterReads: 0,
      subscribers: new Map<string, (event: Event) => void>(),
    };
    const pool = {
      async connect() {
        return {
          async query() {
            return { rows: [] };
          },
          release() {},
        };
      },
      async query(sql: string, params?: unknown[]) {
        // claimUndeliverableNotice, standing in for the real
        // INSERT ... ON CONFLICT DO NOTHING RETURNING: a row comes back to the
        // first claimer of a (source endpoint, source event) and to nobody
        // after it, for as long as the table exists.
        if (sql.includes("INSERT INTO bridge_undeliverable_notices")) {
          const key = `${params?.[0]}:${params?.[1]}`;
          state.noticeClaims.push(key);
          if (state.claimedNotices.has(key)) return { rows: [] };
          state.claimedNotices.add(key);
          return { rows: [{ source_event_id: params?.[1] }] };
        }
        if (sql.includes("FROM community_connections")) {
          return {
            rows: connections.map((connection) => {
              const privateKey = keys.get(connection.id)!;
              const encrypted = encryptConnectorPrivateKey(
                privateKey,
                wrappingKey,
                connection.communityId,
              );
              return {
                bridge_pubkey: getPublicKey(privateKey),
                community_id: connection.communityId,
                encrypted_private_key: encrypted.ciphertext,
                health: "healthy",
                id: connection.id,
                private_key_auth_tag: encrypted.authTag,
                private_key_nonce: encrypted.nonce,
                relay_url_snapshot: connection.relayUrl,
                state: "active",
                wrapping_key_version: 1,
              };
            }),
          };
        }
        // findRoutableCommunityBySlug: only `@destination` is connected.
        if (sql.includes("FROM communities")) {
          const slug = String(params?.[1] ?? "");
          state.destinationLookups.push(slug);
          return slug === "destination"
            ? {
                rows: [{
                  community_id: DESTINATION_COMMUNITY,
                  slug: "destination",
                }],
              }
            : { rows: [] };
        }
        if (sql.includes("FROM shared_channel_endpoints AS endpoints")) {
          return {
            rows: [{
              connection_id: SOURCE_CONNECTION,
              last_event_created_at: 0,
              local_channel_id: "general",
              shared_channel_id: SHARED_CHANNEL,
              source_endpoint_id: SOURCE_ENDPOINT,
            }],
          };
        }
        return { rows: [] };
      },
    };
    const profiles = options.profiles ?? { [ALICE]: "Alice", [BOB]: null };
    const relayFactory = {
      async connect(relayUrl: string) {
        const relay: RelayConnection = {
          close() {},
          async getProfileName(pubkey: string) {
            if (relayUrl === DESTINATION_RELAY) {
              state.profileReads += 1;
              if (options.profileCostMs) {
                vi.setSystemTime(Date.now() + options.profileCostMs);
              }
            }
            return profiles[pubkey] ?? null;
          },
          async hasEvent() {
            return false;
          },
          async listGroups() {
            return [];
          },
          async publish(event: Event) {
            if (relayUrl !== SOURCE_RELAY) return;
            state.published.push(event);
            // A notice is an ordinary kind-9 in the channel, so the relay
            // stores it and replays it like any other message.
            state.channelLog.push(event);
          },
          async readGroupMembers() {
            return new Set<string>();
          },
          async readRoster() {
            return new Set<string>();
          },
          async readRosterRoles() {
            if (relayUrl !== DESTINATION_RELAY) return new Map();
            state.rosterReads += 1;
            if (options.rosterReadable === false) return null;
            return new Map(
              Object.keys(profiles).map((pubkey) => [pubkey, "member"]),
            );
          },
          subscribe(routes, _watchRoster, onEvent) {
            state.subscribers.set(relayUrl, onEvent);
            if (relayUrl !== SOURCE_RELAY || routes.length === 0) return;
            // `since` is inclusive, so a REQ replays the event sitting exactly
            // at the cursor as well as everything after it.
            const since = Math.min(
              ...routes.map((route) => route.lastEventCreatedAt),
            );
            for (const stored of state.channelLog) {
              if (stored.created_at >= since) onEvent(stored);
            }
          },
        };
        return relay;
      },
    };
    /** A process: same relay, same database, no memory of the last one. */
    const startProcess = () =>
      new ConnectorSupervisor(
        pool as never,
        {} as never,
        { async getKey() { return wrappingKey; } },
        relayFactory,
      );
    const supervisor = startProcess();

    return {
      startProcess,
      state,
      supervisor,
      /**
       * What the connector does when a session has gone quiet: drop it and
       * subscribe again from the route cursor, which an unrouted message never
       * advances.
       */
      async rebuild() {
        vi.setSystemTime(Date.now() + 120_000);
        await supervisor.reconcile();
      },
      /** Post a message into the source community's bridged channel. */
      say(content: string, privateKey = generateSecretKey()): Event {
        const event = finalizeEvent(
          {
            content,
            created_at: Math.floor(Date.now() / 1_000),
            kind: 9,
            tags: [["h", "general"]],
          },
          privateKey,
        );
        state.channelLog.push(event);
        state.subscribers.get(SOURCE_RELAY)!(event);
        return event;
      },
      /** Let every immediately-resolving relay/pool step run to completion. */
      async settle() {
        for (let tick = 0; tick < 10; tick += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      },
    };
  }

  it("bounces a bare first-token address that names no connected community", async () => {
    const { say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    say("@trustysqire hello");
    await settle();

    expect(state.published).toHaveLength(1);
    expect(state.published[0]).toMatchObject({
      content: undeliverableNotice("trustysqire"),
      kind: 9,
      tags: [["h", "general"], ["br", "notice", "unknown-destination"]],
    });
    expect(state.published[0].content).toContain("@trustysqire");
    await supervisor.stop();
  });

  // THE STORM. #97 shipped without this test and posted ~20 identical notices
  // into a live channel, about one a minute, until it was reverted.
  //
  // Nothing about the notice itself was looping: the source message was. A
  // message that does not route is never ingested, so it never advances
  // `last_event_created_at`; the idle rebuild re-subscribes from that cursor;
  // the relay replays the same unroutable event; the connector bounces it
  // again. Ingestion has always been idempotent by source event id — the
  // notice was the one effect that was not.
  it("bounces a source event once however often the rebuild re-reads it", async () => {
    const { rebuild, say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    const source = say("@trustysqire hello");
    await settle();
    expect(state.published).toHaveLength(1);

    await rebuild();
    await settle();
    await rebuild();
    await settle();

    // The event really was re-read each time — the claim is what stayed the
    // notice, not a subscription that quietly stopped replaying.
    expect(state.noticeClaims).toEqual([
      `${SOURCE_ENDPOINT}:${source.id}`,
      `${SOURCE_ENDPOINT}:${source.id}`,
      `${SOURCE_ENDPOINT}:${source.id}`,
    ]);
    expect(state.published).toHaveLength(1);
    await supervisor.stop();
  });

  // Same loop, same claim, for the half that needs the destination roster.
  it("bounces an unknown user once however often the rebuild re-reads it", async () => {
    const { rebuild, say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    say("@destination/nosuchperson hello");
    await settle();
    expect(state.published).toHaveLength(1);

    await rebuild();
    await settle();

    expect(state.noticeClaims).toHaveLength(2);
    expect(state.published).toHaveLength(1);
    await supervisor.stop();
  });

  // A restart is the same replay with none of the process's memory, which is
  // why the claim is a database row and not a Set on the supervisor.
  it("does not bounce again after a restart replays the channel", async () => {
    const { say, settle, startProcess, state, supervisor } = routingHarness();
    await supervisor.start();
    say("@trustysqire hello");
    await settle();
    await supervisor.stop();
    expect(state.published).toHaveLength(1);

    const restarted = startProcess();
    await restarted.start();
    await settle();

    expect(state.published).toHaveLength(1);
    await restarted.stop();
  });

  // The core of the product: only the addressing position routes, so an
  // ordinary mention must be neither mirrored nor answered.
  it.each([
    ["a mid-sentence mention", "hey @trustysqire can you look"],
    ["a trailing mention", "thanks @trustysqire"],
    ["ordinary conversation", "just talking here"],
  ])("neither routes nor bounces %s", async (_label, content) => {
    const { say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    say(content);
    await settle();

    expect(state.published).toHaveLength(0);
    expect(state.destinationLookups).toHaveLength(0);
    await supervisor.stop();
  });

  it("bounces an unknown user in a community that is connected", async () => {
    const { say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    say("@destination/nosuchperson hello");
    await settle();

    expect(state.published).toHaveLength(1);
    expect(state.published[0]).toMatchObject({
      content: undeliverableNotice("destination", "nosuchperson"),
      tags: [["h", "general"], ["br", "notice", "unknown-user"]],
    });
    // The notice has to say which half failed, not just that something did.
    expect(state.published[0].content).toContain("@destination is connected");
    expect(state.published[0].content).toContain("nobody there is named");
    await supervisor.stop();
  });

  it("delivers to a user the destination roster knows, whatever the casing", async () => {
    const { say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    say("@destination/ALICE hello");
    await settle();

    expect(state.published).toHaveLength(0);
    expect(state.rosterReads).toBe(1);
    await supervisor.stop();
  });

  it("delivers to a member addressed by pubkey", async () => {
    const { say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    say(`@destination/${BOB} hello`);
    await settle();

    expect(state.published).toHaveLength(0);
    expect(state.rosterReads).toBe(1);
    await supervisor.stop();
  });

  // Our own connection being unhealthy is not evidence about their roster.
  it("does not bounce a user when the destination roster cannot be read", async () => {
    const { say, settle, state, supervisor } = routingHarness({
      rosterReadable: false,
    });
    await supervisor.start();

    say("@destination/nosuchperson hello");
    await settle();

    expect(state.published).toHaveLength(0);
    await supervisor.stop();
  });

  // A bounce per message is fine; re-reading the roster per message is not.
  it("reuses one roster read across a burst of bounces", async () => {
    const { say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    say("@destination/nosuchperson one");
    await settle();
    say("@destination/nosuchperson two");
    say("@destination/nosuchperson three");
    await settle();

    expect(state.published).toHaveLength(3);
    expect(state.rosterReads).toBe(1);
    // Profiles are cached for the life of the connection, so the roster
    // members are resolved once and not once per message.
    expect(state.profileReads).toBe(2);
    await supervisor.stop();
  });

  // A burst arriving before the first index finishes must share that one build.
  it("reads the destination roster once for concurrent addressed messages", async () => {
    const { say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    say("@destination/nosuchperson one");
    say("@destination/nosuchperson two");
    say("@destination/nosuchperson three");
    await settle();

    expect(state.published).toHaveLength(3);
    expect(state.rosterReads).toBe(1);
    await supervisor.stop();
  });

  // Validation must never become an outage. A roster too slow to index inside
  // the budget delivers unvalidated instead of holding the message.
  it("abandons an index that runs long instead of bouncing on a partial one", async () => {
    const profiles = Object.fromEntries(
      Array.from({ length: 64 }, (_, member) => [
        member.toString(16).padStart(64, "0"),
        `member-${member}`,
      ]),
    );
    const { say, settle, state, supervisor } = routingHarness({
      profileCostMs: 1_000,
      profiles,
    });
    await supervisor.start();

    // `member-0` IS on the roster, but the index never got far enough to say
    // so — and a half-built index must not be trusted to deny anyone.
    say("@destination/nosuchperson one");
    say("@destination/member-0 two");
    await settle();

    expect(state.published).toHaveLength(0);
    expect(state.profileReads).toBeLessThan(64);
    await supervisor.stop();
  });

  it("cannot re-ingest or re-bounce its own notice", async () => {
    const { say, settle, state, supervisor } = routingHarness();
    await supervisor.start();

    say("@trustysqire hello");
    await settle();
    const notice = state.published[0]!;

    // The notice is an ordinary kind-9 the bridge will read back. It carries no
    // projection marker, so being bridge-authored is what stops it — and its
    // text is unaddressed, so it routes nowhere even if that check is reached.
    expect(hasBuzzRouterProjectionMarker(notice)).toBe(false);
    expect(parseMessageAddress(notice.content)).toBeNull();
    expect(
      canonicalizeSourceEvent(notice, {
        bridgePubkey: notice.pubkey,
        localChannelId: "general",
        sharedChannelId: SHARED_CHANNEL,
        sourceEndpointId: SOURCE_ENDPOINT,
      }),
    ).toBeNull();

    state.subscribers.get(SOURCE_RELAY)!(notice);
    await settle();
    expect(state.published).toHaveLength(1);
    // The notice carries its own event id, so the once-per-source-event claim
    // would not have covered it: nothing even reached that check.
    expect(state.noticeClaims).toHaveLength(1);
    await supervisor.stop();
  });
});

describe("parseWrappingKeyFile", () => {
  it("loads versioned 32-byte wrapping keys", () => {
    const first = randomBytes(32);
    const second = randomBytes(32);
    const keys = parseWrappingKeyFile(
      JSON.stringify({
        1: first.toString("base64"),
        2: second.toString("base64"),
      }),
    );

    expect(keys.get(1)).toEqual(first);
    expect(keys.get(2)).toEqual(second);
  });

  it("rejects malformed and incorrectly sized keys", () => {
    expect(() => parseWrappingKeyFile("[]")).toThrowError(
      expect.objectContaining({ code: "wrapping_key_file_invalid" }),
    );
    expect(() =>
      parseWrappingKeyFile(
        JSON.stringify({ 1: randomBytes(16).toString("base64") }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "wrapping_key_file_invalid" }),
    );
  });
});
