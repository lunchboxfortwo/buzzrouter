import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { JoinabilityVerdict } from "../directory/joinability";
import {
  probeCommunityJoinability,
  STALE_AFTER_MS,
  type ProbeJoinabilityFn,
} from "./probe-joinability";

interface Target {
  candidate_id: string;
  host: string;
  code: string;
}

/**
 * A pg Pool whose SELECT returns the given due targets and whose INSERT (the
 * verdict upsert) resolves empty, recording every recorded verdict and the
 * `staleBefore` bound the job passed to the due-candidate query.
 */
function makePool(targets: Target[]): {
  pool: Pool;
  recorded: unknown[][];
  staleBounds: unknown[];
} {
  const recorded: unknown[][] = [];
  const staleBounds: unknown[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO community_join_probes/i.test(sql)) {
      recorded.push(params);
      return { rows: [] };
    }
    if (/FROM community_candidates/i.test(sql)) {
      staleBounds.push(params[0]);
      return { rows: targets };
    }
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, recorded, staleBounds };
}

function probeReturning(
  byHost: Record<string, JoinabilityVerdict>,
): ProbeJoinabilityFn {
  return vi.fn(async ({ host }: { host: string }) => {
    const verdict = byHost[host];
    if (!verdict) throw new Error(`unexpected probe of ${host}`);
    return verdict;
  });
}

describe("probeCommunityJoinability", () => {
  it("probes each due candidate, records its verdict, and tallies by status", async () => {
    const { pool, recorded } = makePool([
      { candidate_id: "c1", code: "code-open", host: "open.example" },
      { candidate_id: "c2", code: "code-gated", host: "gated.example" },
      { candidate_id: "c3", code: "code-owner", host: "owner.example" },
    ]);
    const probe = probeReturning({
      "gated.example": { detail: "join_policy_required", status: "policy_gated" },
      "open.example": { status: "open" },
      "owner.example": { detail: "not_a_member", status: "restricted" },
    });

    const result = await probeCommunityJoinability({ pool, probe });

    expect(result).toMatchObject({
      checked: 3,
      errors: 0,
      open: 1,
      policyGated: 1,
      restricted: 1,
    });
    // Each verdict is upserted against the exact code that was probed.
    expect(recorded).toEqual([
      ["c1", "code-open", "open", null],
      ["c2", "code-gated", "policy_gated", "join_policy_required"],
      ["c3", "code-owner", "restricted", "not_a_member"],
    ]);
  });

  it("selects due candidates against the decay window (now - STALE_AFTER_MS)", async () => {
    const { pool, staleBounds } = makePool([]);
    const now = new Date("2026-08-01T12:00:00.000Z");

    await probeCommunityJoinability({ now, pool, probe: probeReturning({}) });

    expect(staleBounds).toHaveLength(1);
    expect((staleBounds[0] as Date).getTime()).toBe(
      now.getTime() - STALE_AFTER_MS,
    );
  });

  it("isolates a probe failure per candidate without aborting the batch", async () => {
    const { pool, recorded } = makePool([
      { candidate_id: "c1", code: "code-1", host: "boom.example" },
      { candidate_id: "c2", code: "code-2", host: "open.example" },
    ]);
    const probe = vi.fn(async ({ host }: { host: string }) => {
      if (host === "boom.example") throw new Error("network down");
      return { status: "open" } as JoinabilityVerdict;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await probeCommunityJoinability({ pool, probe });

    expect(result.errors).toBe(1);
    expect(result.checked).toBe(1);
    expect(result.open).toBe(1);
    // Only the surviving candidate's verdict is recorded.
    expect(recorded).toEqual([["c2", "code-2", "open", null]]);
  });
});
