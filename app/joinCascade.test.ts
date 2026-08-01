import { describe, expect, it } from "vitest";

import { buildInviteUrl, hasJoinTarget } from "./joinCascade";

describe("buildInviteUrl", () => {
  it("builds the relay's hosted web invite link from a wss relay URL", () => {
    expect(
      buildInviteUrl("wss://creatormagic.communities.buzz.xyz", "TOKEN-123"),
    ).toBe("https://creatormagic.communities.buzz.xyz/invite/TOKEN-123");
  });

  it("strips the scheme and any trailing slash from the relay host", () => {
    expect(buildInviteUrl("wss://relay.example/", "abc")).toBe(
      "https://relay.example/invite/abc",
    );
  });

  it("preserves a JWT-style token verbatim (dots, dashes, underscores)", () => {
    const token = "eyJhbGci.In0_ok-9J";
    expect(buildInviteUrl("wss://r.example", token)).toBe(
      `https://r.example/invite/${token}`,
    );
  });

  it("preserves a v2-style opaque code verbatim", () => {
    const code = "v2.umQGOlbNHvzs5fDVgxWCcU1N6ZmKr_3QAqPiuM4AgV4";
    expect(buildInviteUrl("wss://buzzdir.communities.buzz.xyz", code)).toBe(
      `https://buzzdir.communities.buzz.xyz/invite/${code}`,
    );
  });

  it("percent-encodes characters that would break the path", () => {
    expect(buildInviteUrl("wss://r.example", "a/b c")).toBe(
      "https://r.example/invite/a%2Fb%20c",
    );
  });
});

describe("hasJoinTarget", () => {
  const base = { inviteCode: null, publicUrl: null, relayUrl: "wss://r.example" };

  it("is true when an invite code is present", () => {
    expect(hasJoinTarget({ ...base, inviteCode: "code" })).toBe(true);
  });

  it("is true when a public URL is present", () => {
    expect(hasJoinTarget({ ...base, publicUrl: "https://x.example" })).toBe(true);
  });

  it("is false when neither is present", () => {
    expect(hasJoinTarget(base)).toBe(false);
  });
});
