import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db/pool", () => ({
  getDatabasePool: () => "pool",
}));

const searchVerifiedCommunities = vi.fn();
vi.mock("../../../src/shared-channels/community-search", () => ({
  searchVerifiedCommunities: (...args: unknown[]) =>
    searchVerifiedCommunities(...args),
}));

describe("GET /api/community-search", () => {
  it("forwards the query and returns verified community matches", async () => {
    searchVerifiedCommunities.mockResolvedValue([
      {
        candidateId: "candidate-1",
        canonicalRelayUrl: "wss://builders.example",
        displayName: "Builders",
        host: "builders.example",
      },
    ]);
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://buzzrouter.com/api/community-search?q=builders"),
    );

    expect(searchVerifiedCommunities).toHaveBeenCalledWith(
      "pool",
      "builders",
    );
    await expect(response.json()).resolves.toEqual({
      communities: [
        {
          candidateId: "candidate-1",
          canonicalRelayUrl: "wss://builders.example",
          displayName: "Builders",
          host: "builders.example",
        },
      ],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
