import { npubEncode } from "nostr-tools/nip19";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildInstallerCommand,
  createCommunityInstallToken,
  resolveInviteClaimTarget,
} from "./installer";
import { beginCommunityConnectionInstall } from "./store";

vi.mock("./store", () => ({
  beginCommunityConnectionInstall: vi.fn(),
}));

const beginInstall = vi.mocked(beginCommunityConnectionInstall);

function stubBeginInstall(relayUrl = "wss://alpha.e2e.example"): void {
  beginInstall.mockResolvedValue({
    connection: { relayUrl } as never,
    expiresAt: "2026-07-31T00:15:00.000Z",
    tokenId: "token-id",
  } as never);
}

describe("community connector installer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    beginInstall.mockReset();
  });

  it("renders the bridge key as an npub and surfaces the raw token", async () => {
    vi.stubEnv("BUZZROUTER_CONNECT_PACKAGE_SPEC", "");
    stubBeginInstall();

    const result = await createCommunityInstallToken(
      { query: vi.fn() } as never,
      {
        communityId: "00000000-0000-4000-8000-000000000000",
        ownerPubkey: "a".repeat(64),
      },
      { getKey: async () => Buffer.alloc(32, 7) },
    );

    // npub is the bech32 encoding of the hex bridge pubkey — not raw hex.
    expect(result.bridgeNpub).toBe(npubEncode(result.bridgePubkey));
    expect(result.bridgeNpub.startsWith("npub1")).toBe(true);
    expect(result.bridgePubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.relayUrl).toBe("wss://alpha.e2e.example");
  });

  it("creates connector state with a null command when the CLI package is unavailable", async () => {
    vi.stubEnv("BUZZROUTER_CONNECT_PACKAGE_SPEC", "");
    stubBeginInstall();

    const result = await createCommunityInstallToken(
      { query: vi.fn() } as never,
      {
        communityId: "00000000-0000-4000-8000-000000000000",
        ownerPubkey: "a".repeat(64),
      },
      { getKey: async () => Buffer.alloc(32, 7) },
    );

    // Hosted owners have no shell: the bridge keypair is still minted so they
    // can admit it from Buzz, and the npx command is simply omitted.
    expect(result.command).toBeNull();
    expect(beginInstall).toHaveBeenCalledOnce();
  });

  it("includes the npx command when the CLI package is published", async () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    vi.stubEnv("BUZZROUTER_CONNECT_PACKAGE_SPEC", "@buzzrouter/connect@0.1.1");
    stubBeginInstall();

    const result = await createCommunityInstallToken(
      { query: vi.fn() } as never,
      {
        communityId: "00000000-0000-4000-8000-000000000000",
        ownerPubkey: "a".repeat(64),
      },
      { getKey: async () => Buffer.alloc(32, 7) },
    );

    expect(result.command).toBe(
      `npx --yes --package=@buzzrouter/connect@0.1.1 buzzrouter-connect ${result.token} --router https://buzzrouter.com`,
    );
  });

  it("pins GitHub release artifacts in generated commands", () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    vi.stubEnv(
      "BUZZROUTER_CONNECT_PACKAGE_SPEC",
      "https://github.com/lunchboxfortwo/buzzrouter/releases/download/connect-v0.1.0/buzzrouter-connect-0.1.0.tgz",
    );

    expect(buildInstallerCommand("a".repeat(43))).toBe(
      "npx --yes --package=https://github.com/lunchboxfortwo/buzzrouter/releases/download/connect-v0.1.0/buzzrouter-connect-0.1.0.tgz buzzrouter-connect " +
        `${"a".repeat(43)} --router https://buzzrouter.com`,
    );
  });

  it("rejects mutable or mismatched release artifacts", () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    vi.stubEnv(
      "BUZZROUTER_CONNECT_PACKAGE_SPEC",
      "https://github.com/lunchboxfortwo/buzzrouter/releases/latest/download/buzzrouter-connect-0.1.0.tgz",
    );

    expect(() => buildInstallerCommand("a".repeat(43))).toThrow(
      "installer is not published",
    );
  });
});

describe("invite claim target resolution", () => {
  const relayOnRecord = "wss://relay.buzzrouter.com";

  it("extracts the code and pins the claim URL to the community relay", () => {
    const target = resolveInviteClaimTarget(
      relayOnRecord,
      "https://relay.buzzrouter.com/invite/abc.def-123",
    );
    expect(target).toEqual({
      claimUrl: "https://relay.buzzrouter.com/api/invites/claim",
      code: "abc.def-123",
    });
  });

  it("accepts a bare invite code against the on-record relay", () => {
    const target = resolveInviteClaimTarget(relayOnRecord, "  abc.def-123  ");
    expect(target).toEqual({
      claimUrl: "https://relay.buzzrouter.com/api/invites/claim",
      code: "abc.def-123",
    });
  });

  it("refuses a link that points at a different relay (SSRF guard)", () => {
    expect(() =>
      resolveInviteClaimTarget(
        relayOnRecord,
        "https://evil.example/invite/abc",
      ),
    ).toThrow("different relay");
  });

  it("rejects a link with no invite code", () => {
    expect(() =>
      resolveInviteClaimTarget(relayOnRecord, "https://relay.buzzrouter.com/"),
    ).toThrow("invite code");
  });
});
