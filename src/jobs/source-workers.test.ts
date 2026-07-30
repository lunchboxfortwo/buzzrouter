import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { withSourceLock } from "./source-workers";

describe("withSourceLock", () => {
  it("runs one reconciliation while holding the source advisory lock", async () => {
    const release = vi.fn();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool;
    const run = vi.fn().mockResolvedValue(undefined);

    await expect(withSourceLock(pool, "github", run)).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("pg_try_advisory_lock"),
      ["buzzrouter.discovery.github"],
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("skips an overlapping reconciliation", async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({
      rows: [{ acquired: false }],
    });
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool;
    const run = vi.fn();

    await expect(withSourceLock(pool, "nip66", run)).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
