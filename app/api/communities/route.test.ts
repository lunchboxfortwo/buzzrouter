import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db/pool", () => ({
  getDatabasePool: () => "pool",
}));

const listDirectoryCommunities = vi.fn();
vi.mock("../../../src/db/directory", () => ({
  listDirectoryCommunities: (...args: unknown[]) =>
    listDirectoryCommunities(...args),
}));

function buildCommunity(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "candidate-1",
    relayHost: "builders.example",
    canonicalRelayUrl: "wss://builders.example",
    displayName: "Builders",
    description: "A builder community",
    focus: "engineering",
    categories: ["dev"],
    joinMode: "invite",
    inviteCode: "abc123",
    joinStatus: "open",
    publicUrl: null,
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    slug: "builders",
    claimed: true,
    evidenceCount: 3,
    ...overrides,
  };
}

describe("GET /api/communities", () => {
  it("returns the public join shape sourced from listDirectoryCommunities", async () => {
    listDirectoryCommunities.mockResolvedValue([buildCommunity()]);
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://buzzrouter.com/api/communities"),
    );
    const body = await response.json();

    expect(listDirectoryCommunities).toHaveBeenCalledWith("pool", {
      limit: 100,
    });
    expect(body).toEqual({
      communities: [
        {
          host: "builders.example",
          relayUrl: "wss://builders.example",
          displayName: "Builders",
          description: "A builder community",
          focus: "engineering",
          categories: ["dev"],
          joinMode: "invite",
          inviteCode: "abc123",
          publicUrl: null,
          lastVerifiedAt: "2026-07-01T00:00:00.000Z",
          slug: "builders",
        },
      ],
      count: 1,
    });
  });

  it("sets public cache headers appropriate for discovery-cadence data", async () => {
    listDirectoryCommunities.mockResolvedValue([]);
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://buzzrouter.com/api/communities"),
    );

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, stale-while-revalidate=3600",
    );
  });

  it("filters ?joinable=true to everything joinable, excluding only known-restricted codes", async () => {
    listDirectoryCommunities.mockResolvedValue([
      // A genuinely open invite (a bare claim lands) — joinable.
      buildCommunity({
        candidateId: "candidate-1",
        inviteCode: "abc123",
        joinStatus: "open",
        publicUrl: null,
        relayHost: "open-invite.example",
      }),
      // A public web-join URL — always joinable.
      buildCommunity({
        candidateId: "candidate-2",
        inviteCode: null,
        joinStatus: null,
        publicUrl: "https://has-url.example",
        relayHost: "has-url.example",
      }),
      // Behind a ToS/age gate — joinable via one consent click, NOT a dead end.
      buildCommunity({
        candidateId: "candidate-3",
        inviteCode: "gated-code",
        joinStatus: "policy_gated",
        publicUrl: null,
        relayHost: "policy-gated.example",
      }),
      // Code present but never probed / verdict decayed — degrade gracefully into
      // the consent flow rather than hide it.
      buildCommunity({
        candidateId: "candidate-4",
        inviteCode: "unprobed-code",
        joinStatus: null,
        publicUrl: null,
        relayHost: "unprobed.example",
      }),
      // A stale (expired) probe is not proof of a closed door — still shown.
      buildCommunity({
        candidateId: "candidate-5",
        inviteCode: "dead-code",
        joinStatus: "stale",
        publicUrl: null,
        relayHost: "stale.example",
      }),
      // Owner-only / allowlist admission — the one case that is withheld.
      buildCommunity({
        candidateId: "candidate-6",
        inviteCode: "owner-code",
        joinStatus: "restricted",
        publicUrl: null,
        relayHost: "restricted.example",
      }),
      // No code and no public URL — nothing to join with.
      buildCommunity({
        candidateId: "candidate-7",
        inviteCode: null,
        joinStatus: null,
        publicUrl: null,
        relayHost: "no-target.example",
      }),
    ]);
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://buzzrouter.com/api/communities?joinable=true"),
    );
    const body = await response.json();

    expect(body.communities.map((c: { host: string }) => c.host)).toEqual([
      "open-invite.example",
      "has-url.example",
      "policy-gated.example",
      "unprobed.example",
      "stale.example",
    ]);
  });

  it("defaults the limit and clamps it to the hard maximum", async () => {
    listDirectoryCommunities.mockResolvedValue([]);
    const { GET } = await import("./route");

    await GET(new Request("https://buzzrouter.com/api/communities?limit=5"));
    expect(listDirectoryCommunities).toHaveBeenLastCalledWith("pool", {
      limit: 5,
    });

    await GET(
      new Request("https://buzzrouter.com/api/communities?limit=99999"),
    );
    expect(listDirectoryCommunities).toHaveBeenLastCalledWith("pool", {
      limit: 200,
    });

    await GET(
      new Request("https://buzzrouter.com/api/communities?limit=not-a-number"),
    );
    expect(listDirectoryCommunities).toHaveBeenLastCalledWith("pool", {
      limit: 100,
    });

    await GET(
      new Request("https://buzzrouter.com/api/communities?limit=-5"),
    );
    expect(listDirectoryCommunities).toHaveBeenLastCalledWith("pool", {
      limit: 100,
    });
  });

  it("never leaks owner pubkeys, claim tokens, or connector/bridge secrets", async () => {
    listDirectoryCommunities.mockResolvedValue([
      buildCommunity({
        ownerPubkey: "npub1shouldnotleak",
        claimToken: "secret-claim-token",
        connectorKey: "secret-connector-key",
        installToken: "secret-install-token",
      }),
    ]);
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://buzzrouter.com/api/communities"),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body).toLowerCase();

    expect(Object.keys(body.communities[0])).toEqual([
      "host",
      "relayUrl",
      "displayName",
      "description",
      "focus",
      "categories",
      "joinMode",
      "inviteCode",
      "publicUrl",
      "lastVerifiedAt",
      "slug",
    ]);
    expect(serialized).not.toContain("pubkey");
    expect(serialized).not.toContain("claim");
    expect(serialized).not.toContain("connector");
    expect(serialized).not.toContain("installtoken");
    expect(serialized).not.toContain("npub1shouldnotleak");
  });
});
