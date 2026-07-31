import { describe, expect, it, vi } from "vitest";

import { parseArguments, runInstaller } from "./installer.js";

const token = "a".repeat(43);
const bridgePubkey = "b".repeat(64);

describe("@buzzrouter/connect", () => {
  it("admits the bridge locally before requesting activation", async () => {
    const calls = [];
    const request = vi.fn(async (_origin, path) => {
      calls.push(path);
      return path.endsWith("/install")
        ? {
            bridgePubkey,
            expiresAt: new Date().toISOString(),
            relayUrl: "wss://relay.example",
          }
        : {
            bridgePubkey,
            relayUrl: "wss://relay.example",
            state: "active",
          };
    });
    const runAdmin = vi.fn(async () => {
      calls.push("buzz-admin");
    });
    const output = { write: vi.fn() };

    await runInstaller([token], { output, request, runAdmin });

    expect(calls).toEqual([
      "/api/community-connections/install",
      "buzz-admin",
      "/api/community-connections/activate",
    ]);
    expect(runAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ bridgePubkey }),
    );
    expect(
      output.write.mock.calls.flat().join(""),
    ).not.toContain(token);
  });

  it("rejects unsafe router origins and malformed tokens", () => {
    expect(() => parseArguments(["short"])).toThrow(
      "valid one-time install token",
    );
    expect(() =>
      parseArguments([
        token,
        "--router",
        "http://router.example",
      ]),
    ).toThrow("HTTPS origin");
  });
});
