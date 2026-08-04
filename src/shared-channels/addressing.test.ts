import { describe, expect, it } from "vitest";

import { parseMessageAddress } from "./addressing";

describe("parseMessageAddress", () => {
  // The bracket form is what the spec said. The bare form is what the first
  // human to use it actually typed, so it has to work too.
  it("accepts the bare form people actually type", () => {
    expect(parseMessageAddress("@trustysquire/lunchbox test")).toEqual({
      slug: "trustysquire",
      user: "lunchbox",
      body: "test",
      explicit: false,
    });
    expect(parseMessageAddress("@trustysquire ship it")).toEqual({
      slug: "trustysquire",
      body: "ship it",
      explicit: false,
    });
  });

  it("marks a bare address as non-explicit so an unknown one stays quiet", () => {
    expect(parseMessageAddress("@bob can you look")?.explicit).toBe(false);
    expect(parseMessageAddress("@[bob] can you look")?.explicit).toBe(true);
  });

  it("routes a community-addressed message and strips the address", () => {
    expect(parseMessageAddress("@[trustysquire] ship it")).toEqual({
      slug: "trustysquire",
      body: "ship it",
      explicit: true,
    });
  });

  it("carries an optional user handle", () => {
    expect(parseMessageAddress("@[trustysquire/alice] ping")).toEqual({
      slug: "trustysquire",
      user: "alice",
      body: "ping",
      explicit: true,
    });
  });

  it("lowercases the slug so addressing is not case-sensitive", () => {
    expect(parseMessageAddress("@[TrustySquire] hi")?.slug).toBe(
      "trustysquire",
    );
  });

  it("tolerates leading whitespace and extra spacing after the address", () => {
    expect(parseMessageAddress("  @[buzzrouter]   hello")).toEqual({
      slug: "buzzrouter",
      body: "hello",
      explicit: true,
    });
  });

  it("keeps the body verbatim after the address, including newlines", () => {
    expect(parseMessageAddress("@[buzzrouter] line one\nline two")?.body).toBe(
      "line one\nline two",
    );
  });

  // The whole point of addressed routing: ordinary chat must never leave the
  // community. An unaddressed message is the common case, not an error.
  it.each([
    ["plain conversation", "just talking here"],
    ["a mid-body address", "see @[buzzrouter] for details"],
    ["an email-ish mention", "mail me at a@[b].com"],
    ["an empty address", "@[] hello"],
  ])("does not route %s", (_label, body) => {
    expect(parseMessageAddress(body)).toBeNull();
  });

  it("does not route an address with no message after it", () => {
    expect(parseMessageAddress("@[buzzrouter]")).toBeNull();
    expect(parseMessageAddress("@[buzzrouter]   ")).toBeNull();
  });

  it("rejects a slug that could not be a real community handle", () => {
    expect(parseMessageAddress("@[UPPER CASE] hi")).toBeNull();
    expect(parseMessageAddress("@[a] hi")).toBeNull(); // too short
    expect(parseMessageAddress(`@[${"a".repeat(41)}] hi`)).toBeNull();
    expect(parseMessageAddress("@[has space] hi")).toBeNull();
  });

  it("rejects a malformed user handle rather than guessing", () => {
    expect(parseMessageAddress("@[buzzrouter/bad handle] hi")).toBeNull();
    expect(parseMessageAddress(`@[buzzrouter/${"u".repeat(65)}] hi`)).toBeNull();
  });
});
