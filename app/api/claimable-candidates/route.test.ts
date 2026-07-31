import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db/pool", () => ({
  getDatabasePool: () => "pool",
}));

const searchClaimableCandidates = vi.fn();
vi.mock("../../../src/claims/store", () => ({
  searchClaimableCandidates: (...args: unknown[]) =>
    searchClaimableCandidates(...args),
}));

describe("GET /api/claimable-candidates", () => {
  it("forwards the q param and returns the match list", async () => {
    searchClaimableCandidates.mockResolvedValue([
      {
        candidateId: "candidate-1",
        canonicalRelayUrl: "wss://builders.example",
        displayName: "Builders",
        host: "builders.example",
      },
    ]);
    const { GET } = await import("./route");

    const response = await GET(
      new Request(
        "https://buzzrouter.com/api/claimable-candidates?q=builders",
      ),
    );
    const body = await response.json();

    expect(searchClaimableCandidates).toHaveBeenCalledWith("pool", "builders");
    expect(body).toEqual({
      candidates: [
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

  it("treats a missing q param as an empty search", async () => {
    searchClaimableCandidates.mockResolvedValue([]);
    const { GET } = await import("./route");

    await GET(new Request("https://buzzrouter.com/api/claimable-candidates"));

    expect(searchClaimableCandidates).toHaveBeenCalledWith("pool", "");
  });
});
