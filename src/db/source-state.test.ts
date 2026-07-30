import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  getSourceCursor,
  recordSourceFailure,
  recordSourceSuccess,
} from "./source-state";

describe("source state", () => {
  it("returns a fallback cursor before the first run", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;

    await expect(
      getSourceCursor(pool, "github", { page: 1 }),
    ).resolves.toEqual({ page: 1 });
  });

  it("stores only structured cursors and aggregate results", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await recordSourceSuccess(
      pool,
      "nip66",
      { since: 123 },
      {
        candidatesAccepted: 4,
        candidatesIgnored: 8,
        eventsRead: 12,
      },
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("last_success_at"),
      [
        "nip66",
        '{"since":123}',
        '{"candidatesAccepted":4,"candidatesIgnored":8,"eventsRead":12}',
      ],
    );
  });

  it("stores a bounded failure code", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await recordSourceFailure(pool, "github", "rate_limited");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("last_error_code"),
      ["github", "rate_limited"],
    );
  });
});
