import { describe, expect, it } from "vitest";

import { DiscoveryError } from "./errors";
import { normalizeRelayUrl } from "./normalize";

describe("normalizeRelayUrl", () => {
  it("reduces invite URLs to a canonical relay origin", () => {
    expect(
      normalizeRelayUrl(
        "https://Example.COM/invite/private-code?code=another#fragment",
      ),
    ).toEqual({
      canonicalRelayUrl: "wss://example.com",
      host: "example.com",
      port: null,
    });
  });

  it("normalizes Unicode hostnames and trailing dots", () => {
    expect(normalizeRelayUrl("wss://BÜCHER.example./room")).toEqual({
      canonicalRelayUrl: "wss://xn--bcher-kva.example",
      host: "xn--bcher-kva.example",
      port: null,
    });
  });

  it("retains non-default ports and canonicalizes IPv6", () => {
    expect(normalizeRelayUrl("ws://[2606:4700:4700::1111]:7447/x")).toEqual({
      canonicalRelayUrl: "wss://[2606:4700:4700::1111]:7447",
      host: "2606:4700:4700::1111",
      port: 7447,
    });
  });

  it("drops input-scheme default ports", () => {
    expect(normalizeRelayUrl("http://relay.example.com:80/path")).toEqual({
      canonicalRelayUrl: "wss://relay.example.com",
      host: "relay.example.com",
      port: null,
    });
  });

  it("rejects embedded credentials without echoing the candidate", () => {
    expect(() =>
      normalizeRelayUrl("https://user:secret@example.com/invite/token"),
    ).toThrowError(
      expect.objectContaining<Partial<DiscoveryError>>({
        code: "embedded_credentials",
        message: "Candidate URLs cannot contain credentials.",
      }),
    );
  });

  it("rejects unsupported transports", () => {
    expect(() => normalizeRelayUrl("ftp://relay.example.com")).toThrowError(
      expect.objectContaining<Partial<DiscoveryError>>({
        code: "unsupported_scheme",
      }),
    );
  });

  it.each([
    "wss://singlelabel",
    "wss://under_score.example.com",
    "wss://-leading.example.com",
    "wss://trailing-.example.com",
  ])("rejects unsafe DNS hostname %s", (candidate) => {
    expect(() => normalizeRelayUrl(candidate)).toThrowError(
      expect.objectContaining<Partial<DiscoveryError>>({
        code: "invalid_host",
      }),
    );
  });
});
