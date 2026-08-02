import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { searchVerifiedCommunities } from "./community-search";

describe("searchVerifiedCommunities", () => {
  it("skips empty searches", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pool;

    await expect(searchVerifiedCommunities(pool, "   ")).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns verified communities whether or not they already have an owner row", async () => {
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

    await expect(searchVerifiedCommunities(pool, "builders")).resolves.toEqual([
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
      expect.not.stringMatching(/owner_pubkey IS NULL/),
      expect.anything(),
    );
  });

  it("trims and bounds input", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await searchVerifiedCommunities(pool, `  ${"a".repeat(200)}  `);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      "a".repeat(100),
      20,
    ]);
  });

  it.each([0, -1, 51, 1.5])("rejects unsafe limit %s", async (limit) => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(
      searchVerifiedCommunities(pool, "builders", limit),
    ).rejects.toThrow("between 1 and 50");
  });
});
