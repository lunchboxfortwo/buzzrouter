import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Event } from "nostr-tools/core";
import type { Relay } from "nostr-tools/relay";

import {
  isPrivilegedRole,
  NostrRelayConnection,
  parseRoster,
  parseWrappingKeyFile,
  resolveRosterRole,
} from "./connector";

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
    const { relay, state } = fakeRelay({
      challenge: false,
      rejectFirstPublish: false,
    });
    const connection = new NostrRelayConnection(relay, randomBytes(32));

    await expect(connection.authenticate()).resolves.toBeUndefined();
    await connection.publish({ id: "f".repeat(64) } as never);

    expect(state.authCalls).toBe(0);
    expect(state.publishCalls).toBe(1);
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

describe("parseRoster / resolveRosterRole", () => {
  const owner = "a".repeat(64);
  const admin = "b".repeat(64);
  const member = "c".repeat(64);

  function rosterEvent(tags: string[][]): Event {
    return { created_at: 1, kind: 13_534, tags } as unknown as Event;
  }

  it("reads inline roles from member tags", () => {
    const roster = parseRoster(
      rosterEvent([
        ["p", owner, "owner"],
        ["p", admin, "admin"],
        ["p", member, "member"],
      ]),
    );
    expect(resolveRosterRole(roster, owner)).toBe("owner");
    expect(resolveRosterRole(roster, admin)).toBe("admin");
    expect(resolveRosterRole(roster, member)).toBe("member");
    expect(resolveRosterRole(roster, "d".repeat(64))).toBeNull();
  });

  it("accepts a trailing role element and defaults a missing role to member", () => {
    const roster = parseRoster(
      rosterEvent([
        ["p", owner, "wss://relay.example", "admin"],
        ["p", member],
      ]),
    );
    expect(resolveRosterRole(roster, owner)).toBe("admin");
    expect(resolveRosterRole(roster, member)).toBe("member");
  });

  it("ignores malformed member entries", () => {
    const roster = parseRoster(
      rosterEvent([
        ["p", "not-a-pubkey", "owner"],
        ["e", owner, "owner"],
        ["p"],
      ]),
    );
    expect(roster.size).toBe(0);
  });

  it("treats only owner and admin as privileged", () => {
    expect(isPrivilegedRole("owner")).toBe(true);
    expect(isPrivilegedRole("admin")).toBe(true);
    expect(isPrivilegedRole("member")).toBe(false);
    expect(isPrivilegedRole("moderator")).toBe(false);
    expect(isPrivilegedRole(null)).toBe(false);
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
