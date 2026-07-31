import { describe, expect, it } from "vitest";

import { extractInvites } from "./extract-invites";

describe("extractInvites", () => {
  it("parses a buzz://join link with an unencoded relay", () => {
    const text = "come join us: buzz://join?relay=wss://relay.example&code=ABC123";
    expect(extractInvites(text)).toEqual([
      { code: "ABC123", relayHost: "relay.example", relayUrl: "wss://relay.example" },
    ]);
  });

  it("parses a buzz://join link with a percent-encoded relay", () => {
    const text =
      "buzz://join?relay=wss%3A%2F%2FRelay.Example%2F&code=xyz-789";
    expect(extractInvites(text)).toEqual([
      { code: "xyz-789", relayHost: "relay.example", relayUrl: "wss://relay.example" },
    ]);
  });

  it("handles buzz://join params in either order", () => {
    const text = "buzz://join?code=CODE1&relay=wss://r.example";
    expect(extractInvites(text)).toEqual([
      { code: "CODE1", relayHost: "r.example", relayUrl: "wss://r.example" },
    ]);
  });

  it("parses an https://host/invite/<code> web link", () => {
    const text = "here you go https://buzz.example/invite/inv_42 enjoy";
    expect(extractInvites(text)).toEqual([
      { code: "inv_42", relayHost: "buzz.example", relayUrl: "wss://buzz.example" },
    ]);
  });

  it("keeps a port on the relay host", () => {
    const text = "buzz://join?relay=wss://localhost:7777&code=DEV";
    expect(extractInvites(text)).toEqual([
      { code: "DEV", relayHost: "localhost:7777", relayUrl: "wss://localhost:7777" },
    ]);
  });

  it("lowercases the host but preserves the code casing", () => {
    const text = "https://Buzz.EXAMPLE/invite/MixedCase";
    expect(extractInvites(text)).toEqual([
      { code: "MixedCase", relayHost: "buzz.example", relayUrl: "wss://buzz.example" },
    ]);
  });

  it("extracts multiple distinct links from one message", () => {
    const text = [
      "Two invites:",
      "buzz://join?relay=wss://a.example&code=aaa",
      "and https://b.example/invite/bbb",
    ].join("\n");
    expect(extractInvites(text)).toEqual([
      { code: "aaa", relayHost: "a.example", relayUrl: "wss://a.example" },
      { code: "bbb", relayHost: "b.example", relayUrl: "wss://b.example" },
    ]);
  });

  it("dedupes by (relayHost, code) across both formats", () => {
    const text =
      "buzz://join?relay=wss://dup.example&code=same " +
      "https://dup.example/invite/same";
    expect(extractInvites(text)).toEqual([
      { code: "same", relayHost: "dup.example", relayUrl: "wss://dup.example" },
    ]);
  });

  it("keeps the same host with two different codes as two invites", () => {
    const text =
      "buzz://join?relay=wss://x.example&code=one " +
      "buzz://join?relay=wss://x.example&code=two";
    expect(extractInvites(text)).toEqual([
      { code: "one", relayHost: "x.example", relayUrl: "wss://x.example" },
      { code: "two", relayHost: "x.example", relayUrl: "wss://x.example" },
    ]);
  });

  it("ignores a buzz://join link missing the code", () => {
    expect(extractInvites("buzz://join?relay=wss://r.example")).toEqual([]);
  });

  it("ignores a buzz://join link missing the relay", () => {
    expect(extractInvites("buzz://join?code=ABC")).toEqual([]);
  });

  it("returns nothing for junk / plain prose", () => {
    expect(
      extractInvites("no invites here, just talking about buzz and joining"),
    ).toEqual([]);
    expect(extractInvites("")).toEqual([]);
    expect(extractInvites("https://example.com/some/other/path")).toEqual([]);
  });

  it("does not choke on trailing punctuation around a link", () => {
    const text = "(buzz://join?relay=wss://p.example&code=paren). Done!";
    expect(extractInvites(text)).toEqual([
      { code: "paren", relayHost: "p.example", relayUrl: "wss://p.example" },
    ]);
  });

  it("extracts an invite embedded mid-sentence in a realistic message", () => {
    const text =
      "hey all, if you missed the announcement the new room is at " +
      "https://community.buzzrouter.dev/invite/spring-2026 — see you there";
    expect(extractInvites(text)).toEqual([
      {
        code: "spring-2026",
        relayHost: "community.buzzrouter.dev",
        relayUrl: "wss://community.buzzrouter.dev",
      },
    ]);
  });
});
