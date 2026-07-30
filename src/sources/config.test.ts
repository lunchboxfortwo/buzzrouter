import { describe, expect, it } from "vitest";

import {
  loadNip66SourceConfig,
  parseCsv,
  parsePubkeys,
} from "./config";

describe("source configuration", () => {
  it("deduplicates bounded CSV configuration", () => {
    expect(
      parseCsv(" one, two,one ", {
        field: "TEST",
        maximum: 3,
        minimum: 2,
      }),
    ).toEqual(["one", "two"]);
  });

  it("requires two independent NIP-66 monitor keys", () => {
    expect(() =>
      parsePubkeys("a".repeat(64), {
        field: "NIP66_MONITOR_PUBKEYS",
        maximum: 100,
        minimum: 2,
      }),
    ).toThrow("2-100");
    expect(() =>
      parsePubkeys(`${"a".repeat(64)},${"a".repeat(64)}`, {
        field: "NIP66_MONITOR_PUBKEYS",
        maximum: 100,
        minimum: 2,
      }),
    ).toThrow("2-100");
    expect(() =>
      parsePubkeys(`${"a".repeat(64)},${"A".repeat(64)}`, {
        field: "NIP66_MONITOR_PUBKEYS",
        maximum: 100,
        minimum: 2,
      }),
    ).toThrow("2-100");
  });

  it("rejects malformed public keys without echoing them", () => {
    expect(() =>
      parsePubkeys("not-a-public-key,bad", {
        field: "NIP66_MONITOR_PUBKEYS",
        maximum: 100,
        minimum: 2,
      }),
    ).toThrow("invalid public key");
  });

  it("loads bounded NIP-66 allowlists through relay validation", async () => {
    const validateRelays = async (relays: string[]) =>
      relays.map((relay) => `${relay}/`);

    await expect(
      loadNip66SourceConfig(
        {
          NIP66_SOURCE_RELAYS:
            "wss://relay-one.example,wss://relay-two.example",
          NIP66_MONITOR_PUBKEYS:
            `${"A".repeat(64)},${"b".repeat(64)}`,
        },
        validateRelays,
      ),
    ).resolves.toEqual({
      monitorPubkeys: ["a".repeat(64), "b".repeat(64)],
      sourceRelays: [
        "wss://relay-one.example/",
        "wss://relay-two.example/",
      ],
    });
  });

  it("fails closed when either NIP-66 allowlist is absent", async () => {
    const validateRelays = async (relays: string[]) => relays;

    await expect(
      loadNip66SourceConfig(
        {
          NIP66_MONITOR_PUBKEYS:
            `${"a".repeat(64)},${"b".repeat(64)}`,
        },
        validateRelays,
      ),
    ).rejects.toThrow("NIP66_SOURCE_RELAYS must contain 1-10 values");

    await expect(
      loadNip66SourceConfig(
        { NIP66_SOURCE_RELAYS: "wss://relay.example" },
        validateRelays,
      ),
    ).rejects.toThrow(
      "NIP66_MONITOR_PUBKEYS must contain 2-100 values",
    );
  });
});
