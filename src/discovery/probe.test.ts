import { describe, expect, it } from "vitest";

import { DiscoveryError } from "./errors";
import type { Nip11Document } from "./nip11";
import { createPinnedLookup, probeRelay } from "./probe";

const buzzDocument: Nip11Document = {
  name: "Buzz Relay",
  software: "https://github.com/block/buzz",
  version: "1.0.0",
  supportedNips: [29, 42],
  relaySelfPubkey: "pubkey",
  limitation: {
    authRequired: true,
    restrictedWrites: true,
  },
};

describe("probeRelay", () => {
  it("never passes an invite path to network probes", async () => {
    const observed: string[] = [];
    const result = await probeRelay(
      "https://relay.example.com/invite/sensitive?code=secret",
      {
        fetchNip11: async (url) => {
          observed.push(url);
          return { document: buzzDocument, status: 200 };
        },
        openWebsocket: async (url) => {
          observed.push(url);
          return { openMs: 12 };
        },
      },
    );

    expect(observed).toEqual([
      "wss://relay.example.com",
      "wss://relay.example.com",
    ]);
    expect(result).toMatchObject({
      ok: true,
      canonicalRelayUrl: "wss://relay.example.com",
      classification: { state: "verified_buzz" },
    });
    expect(JSON.stringify(result)).not.toContain("sensitive");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("returns a safe failure code without remote error text", async () => {
    const result = await probeRelay("wss://relay.example.com", {
      fetchNip11: async () => {
        throw new DiscoveryError(
          "invalid_nip11",
          "Remote body contained a private token.",
        );
      },
    });

    expect(result).toEqual({
      ok: false,
      canonicalRelayUrl: "wss://relay.example.com",
      resultCode: "invalid_nip11",
    });
  });
});

describe("createPinnedLookup", () => {
  it("returns an address array when Node requests all answers", async () => {
    const lookup = createPinnedLookup({ address: "1.1.1.1", family: 4 });

    await expect(
      new Promise((resolve, reject) => {
        lookup("relay.example.com", { all: true }, (error, addresses) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(addresses);
        });
      }),
    ).resolves.toEqual([{ address: "1.1.1.1", family: 4 }]);
  });

  it("returns a single address for the legacy lookup shape", async () => {
    const lookup = createPinnedLookup({
      address: "2606:4700:4700::1111",
      family: 6,
    });

    await expect(
      new Promise((resolve, reject) => {
        lookup("relay.example.com", {}, (error, address, family) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({ address, family });
        });
      }),
    ).resolves.toEqual({
      address: "2606:4700:4700::1111",
      family: 6,
    });
  });
});
