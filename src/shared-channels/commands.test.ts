import { describe, expect, it } from "vitest";

import { COMMAND_USAGE, parseCommand } from "./commands";

describe("parseCommand", () => {
  it("parses /open <slug>", () => {
    expect(parseCommand("/open trustysquire")).toEqual({
      kind: "open",
      slug: "trustysquire",
    });
  });

  it("lowercases the /open slug so casing does not matter", () => {
    expect(parseCommand("/open TrustySquire")).toEqual({
      kind: "open",
      slug: "trustysquire",
    });
  });

  it("ignores trailing text after the /open slug", () => {
    expect(parseCommand("/open trustysquire please")).toEqual({
      kind: "open",
      slug: "trustysquire",
    });
  });

  it("treats /open with no slug as usage, not a silent no-op", () => {
    const result = parseCommand("/open");
    expect(result).toEqual({
      kind: "usage",
      message: expect.stringContaining("/open <community>"),
    });
  });

  it("treats /open with a malformed slug as usage", () => {
    // Underscore, a leading @, and a single char all fail the slug shape.
    expect(parseCommand("/open bad_slug")).toMatchObject({ kind: "usage" });
    expect(parseCommand("/open @nope")).toMatchObject({ kind: "usage" });
    expect(parseCommand("/open x")).toMatchObject({ kind: "usage" });
  });

  it("parses /close <slug>", () => {
    expect(parseCommand("/close relay3")).toEqual({
      kind: "close",
      slug: "relay3",
    });
  });

  it("parses bare /close as a null slug (close the current direct channel)", () => {
    expect(parseCommand("/close")).toEqual({ kind: "close", slug: null });
  });

  it("treats /close with a malformed slug as usage", () => {
    expect(parseCommand("/close b@d")).toMatchObject({ kind: "usage" });
  });

  it("parses /list", () => {
    expect(parseCommand("/list")).toEqual({ kind: "list" });
    expect(parseCommand("/list extra ignored")).toEqual({ kind: "list" });
  });

  it("tolerates surrounding and internal whitespace", () => {
    expect(parseCommand("   /open   trustysquire  ")).toEqual({
      kind: "open",
      slug: "trustysquire",
    });
    expect(parseCommand("\t/list\n")).toEqual({ kind: "list" });
  });

  it("returns null for ordinary chat", () => {
    expect(parseCommand("hello world")).toBeNull();
    expect(parseCommand("open trustysquire")).toBeNull();
    expect(parseCommand("@trustysquire ship it")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
  });

  it("returns null for a leading slash with an unknown verb", () => {
    // "Only `/` + a known verb is a command; everything else is chat." A stray
    // slash (a path, a typo) must not draw a reply.
    expect(parseCommand("/help")).toBeNull();
    expect(parseCommand("/home/user/file")).toBeNull();
    expect(parseCommand("/openish")).toBeNull();
  });

  it("does not treat a mid-message slash as a command", () => {
    expect(parseCommand("run /open trustysquire")).toBeNull();
  });

  it("exposes a shared usage string", () => {
    expect(COMMAND_USAGE).toContain("/open");
    expect(COMMAND_USAGE).toContain("/close");
    expect(COMMAND_USAGE).toContain("/list");
  });
});
