import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { claimDueCandidateIds } from "./candidates";

describe("claimDueCandidateIds", () => {
  it("returns the leased candidate IDs from the bounded query", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: "candidate-1" }, { id: "candidate-2" }],
    });
    const pool = { query } as unknown as Pool;

    await expect(claimDueCandidateIds(pool, 25)).resolves.toEqual([
      "candidate-1",
      "candidate-2",
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FOR UPDATE SKIP LOCKED"),
      [25],
    );
  });

  it.each([0, -1, 1001, 1.5])("rejects unsafe batch limit %s", async (limit) => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(claimDueCandidateIds(pool, limit)).rejects.toThrow(
      "between 1 and 1000",
    );
  });
});
