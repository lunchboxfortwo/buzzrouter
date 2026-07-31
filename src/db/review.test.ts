import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { listCandidateReviews } from "./review";

const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";

describe("listCandidateReviews", () => {
  it("returns no rows without querying sources or probes", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const pool = { query } as unknown as Pool;

    await expect(listCandidateReviews(pool)).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("LEFT JOIN communities"),
      [100],
    );
  });

  it("carries curated focus, display name override, and state through", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: CANDIDATE_ID,
            canonical_relay_url: "wss://relay.example.com",
            state: "verified_buzz",
            first_seen_at: new Date("2026-07-01T00:00:00Z"),
            last_seen_at: new Date("2026-07-29T00:00:00Z"),
            next_probe_at: new Date("2026-07-30T00:00:00Z"),
            classifier_reason: null,
            focus: "ai-agents",
            display_name_override: "Buzz Builders",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query } as unknown as Pool;

    const result = await listCandidateReviews(pool);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      displayNameOverride: "Buzz Builders",
      focus: "ai-agents",
      id: CANDIDATE_ID,
      state: "verified_buzz",
    });
  });

  it("returns null focus and display name override when uncurated", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: CANDIDATE_ID,
            canonical_relay_url: "wss://relay.example.com",
            state: "verified_buzz",
            first_seen_at: new Date("2026-07-01T00:00:00Z"),
            last_seen_at: new Date("2026-07-29T00:00:00Z"),
            next_probe_at: new Date("2026-07-30T00:00:00Z"),
            classifier_reason: null,
            focus: null,
            display_name_override: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query } as unknown as Pool;

    const result = await listCandidateReviews(pool);

    expect(result[0]?.displayNameOverride).toBeNull();
    expect(result[0]?.focus).toBeNull();
  });

  it("rejects an out-of-range limit", async () => {
    const pool = { query: vi.fn() } as unknown as Pool;

    await expect(listCandidateReviews(pool, 0)).rejects.toThrow(
      "between 1 and 500",
    );
  });
});
