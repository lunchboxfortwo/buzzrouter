import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { searchClaimableCandidates } from "./store";

describe("searchClaimableCandidates", () => {
  it("skips the query and returns no results for an empty search", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pool;

    await expect(searchClaimableCandidates(pool, "   ")).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("only searches verified candidates without an owner", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          candidate_id: "candidate-1",
          canonical_relay_url: "wss://builders.example",
          display_name: "Builders",
          host: "builders.example",
        },
      ],
    });
    const pool = { query } as unknown as Pool;

    await expect(
      searchClaimableCandidates(pool, "builders"),
    ).resolves.toEqual([
      {
        candidateId: "candidate-1",
        canonicalRelayUrl: "wss://builders.example",
        displayName: "Builders",
        host: "builders.example",
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/state = 'verified_buzz'/),
      ["builders", 20],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/owner_pubkey IS NULL/),
      expect.anything(),
    );
  });

  it("trims and bounds the search term", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await searchClaimableCandidates(pool, `  ${"a".repeat(200)}  `);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      "a".repeat(100),
      20,
    ]);
  });

  it.each([0, -1, 51, 1.5])("rejects an unsafe limit %s", async (limit) => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(
      searchClaimableCandidates(pool, "builders", limit),
    ).rejects.toThrow("between 1 and 50");
  });
});
