import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Relay } from "nostr-tools/relay";

import {
  NostrRelayConnection,
  parseWrappingKeyFile,
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
