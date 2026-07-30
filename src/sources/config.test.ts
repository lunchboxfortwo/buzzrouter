import { describe, expect, it } from "vitest";

import { parseCsv, parsePubkeys } from "./config";

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
});
