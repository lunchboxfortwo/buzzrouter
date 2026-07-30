import { describe, expect, it } from "vitest";

import { DiscoveryError } from "./errors";
import {
  assertPublicHostname,
  assertPublicIp,
  resolvePublicAddresses,
} from "./network-policy";

describe("network policy", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.10",
    "198.18.0.1",
    "198.51.100.10",
    "203.0.113.10",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
  ])("rejects non-public address %s", (address) => {
    expect(() => assertPublicIp(address)).toThrowError(
      expect.objectContaining<Partial<DiscoveryError>>({
        code: "blocked_address",
      }),
    );
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public unicast address %s",
    (address) => {
      expect(() => assertPublicIp(address)).not.toThrow();
    },
  );

  it.each([
    "localhost",
    "api.localhost",
    "relay.local",
    "metadata.google.internal",
    "service.internal",
    "node.home.arpa",
    "hidden.onion",
    "reserved.example",
    "reserved.invalid",
    "reserved.test",
  ])("rejects blocked hostname %s before DNS", (host) => {
    expect(() => assertPublicHostname(host)).toThrowError(
      expect.objectContaining<Partial<DiscoveryError>>({
        code: "blocked_host",
      }),
    );
  });

  it("rejects the entire resolution when any answer is private", async () => {
    await expect(
      resolvePublicAddresses("relay.example.com", async () => [
        { address: "1.1.1.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toMatchObject({ code: "blocked_address" });
  });

  it("deduplicates validated DNS answers", async () => {
    await expect(
      resolvePublicAddresses("relay.example.com", async () => [
        { address: "1.1.1.1", family: 4 },
        { address: "1.1.1.1", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ]),
    ).resolves.toEqual([
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
  });
});
