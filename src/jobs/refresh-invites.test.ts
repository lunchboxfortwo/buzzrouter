import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InviteHealth } from "../presence/probe-invite";
import {
  refreshStaleInvites,
  registerRefreshInvitesWorker,
  type ProbeInviteFn,
} from "./refresh-invites";
import { REFRESH_INVITES_QUEUE } from "./queues";

const KEY = Uint8Array.from([1, 2, 3]);

interface PoolConfig {
  joined: { relay_host: string; relay_url: string; community_id: string | null }[];
  directoryByHost: Record<string, { candidate_id: string; code: string }>;
  candidatesByHost?: Record<string, { code: string }[]>;
}

/** A pg Pool whose query routes by SQL, recording swap + delete calls. */
function makePool(config: PoolConfig): {
  pool: Pool;
  replaceCalls: unknown[][];
  deleteCalls: unknown[][];
} {
  const replaceCalls: unknown[][] = [];
  const deleteCalls: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/FROM presence_communities/i.test(sql)) {
      return { rows: config.joined };
    }
    if (/JOIN community_candidates/i.test(sql)) {
      const host = String(params[0]).replace(/^wss:\/\//, "");
      const dir = config.directoryByHost[host];
      return { rows: dir ? [dir] : [] };
    }
    if (/DELETE FROM harvested_invite_candidates/i.test(sql)) {
      deleteCalls.push(params);
      return { rows: [] };
    }
    if (/FROM harvested_invite_candidates/i.test(sql)) {
      return { rows: config.candidatesByHost?.[String(params[0])] ?? [] };
    }
    if (/UPDATE community_sources/i.test(sql)) {
      replaceCalls.push(params);
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { deleteCalls, pool: { query } as unknown as Pool, replaceCalls };
}

/** A probe stub that resolves each code to a fixed health verdict. */
function probeReturning(byCode: Record<string, InviteHealth>): ProbeInviteFn {
  return vi.fn(async ({ code }) => byCode[code] ?? "error");
}

function joined(host: string): {
  relay_host: string;
  relay_url: string;
  community_id: string | null;
} {
  return { community_id: null, relay_host: host, relay_url: `wss://${host}` };
}

/** An invite token whose payload carries the given Unix-seconds expiry. */
function codeExpiring(atSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ c: "x", e: atSeconds }), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${payload}.sig`;
}

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refreshStaleInvites", () => {
  it("skips a community whose directory invite is still live", async () => {
    const { pool, replaceCalls } = makePool({
      directoryByHost: { "home.example": { candidate_id: "cand-1", code: "LIVE" } },
      joined: [joined("home.example")],
    });
    const probe = probeReturning({ LIVE: "live" });

    const result = await refreshStaleInvites({ pool, privateKey: KEY, probe });

    expect(result).toEqual({
      checked: 1,
      errors: 0,
      expiringNoCandidate: 0,
      live: 1,
      replaced: 0,
      stillStale: 0,
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(replaceCalls).toHaveLength(0);
  });

  it("swaps in the first live candidate when the directory invite is expired", async () => {
    const { pool, replaceCalls, deleteCalls } = makePool({
      candidatesByHost: { "home.example": [{ code: "C1" }, { code: "C2" }] },
      directoryByHost: { "home.example": { candidate_id: "cand-1", code: "STALE" } },
      joined: [joined("home.example")],
    });
    // Directory code + first candidate are dead; the second candidate is live.
    const probe = probeReturning({ C1: "invalid", C2: "live", STALE: "expired" });

    const result = await refreshStaleInvites({ pool, privateKey: KEY, probe });

    expect(result).toEqual({
      checked: 1,
      errors: 0,
      expiringNoCandidate: 0,
      live: 0,
      replaced: 1,
      stillStale: 0,
    });
    // Swapped the winning candidate into the candidate's source rows...
    expect(replaceCalls).toEqual([["cand-1", "C2"]]);
    // ...and consumed it from the harvested-candidate table.
    expect(deleteCalls).toEqual([["home.example", "C2"]]);
  });

  it("leaves the community stale when no candidate probes live", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { pool, replaceCalls } = makePool({
      candidatesByHost: { "home.example": [{ code: "C1" }] },
      directoryByHost: { "home.example": { candidate_id: "cand-1", code: "STALE" } },
      joined: [joined("home.example")],
    });
    const probe = probeReturning({ C1: "expired", STALE: "expired" });

    const result = await refreshStaleInvites({ pool, privateKey: KEY, probe });

    expect(result).toMatchObject({ checked: 1, replaced: 0, stillStale: 1 });
    expect(replaceCalls).toHaveLength(0);
    // Logs the host + reason, never the code.
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("home.example");
    expect(logged).not.toContain("STALE");
  });

  it("proactively swaps a live-but-expiring code for a longer-lived candidate", async () => {
    const soon = codeExpiring(NOW + 2 * DAY); // live, within the 7-day window
    const fresh = codeExpiring(NOW + 60 * DAY); // live, lasts much longer
    const { pool, replaceCalls, deleteCalls } = makePool({
      candidatesByHost: { "home.example": [{ code: fresh }] },
      directoryByHost: { "home.example": { candidate_id: "cand-1", code: soon } },
      joined: [joined("home.example")],
    });
    const probe = probeReturning({ [fresh]: "live", [soon]: "live" });

    const result = await refreshStaleInvites({ now: NOW, pool, privateKey: KEY, probe });

    expect(result).toMatchObject({ expiringNoCandidate: 0, live: 0, replaced: 1 });
    expect(replaceCalls).toEqual([["cand-1", fresh]]);
    expect(deleteCalls).toEqual([["home.example", fresh]]);
  });

  it("flags a live-but-expiring code with no fresher candidate (nudge signal)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const soon = codeExpiring(NOW + 2 * DAY);
    const { pool, replaceCalls } = makePool({
      directoryByHost: { "home.example": { candidate_id: "cand-1", code: soon } },
      joined: [joined("home.example")],
    });
    const probe = probeReturning({ [soon]: "live" });

    const result = await refreshStaleInvites({ now: NOW, pool, privateKey: KEY, probe });

    expect(result).toMatchObject({
      expiringNoCandidate: 1,
      live: 0,
      replaced: 0,
      stillStale: 0,
    });
    expect(replaceCalls).toHaveLength(0);
  });

  it("does not churn a live-but-expiring code for an equally-soon candidate", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const soon = codeExpiring(NOW + 2 * DAY);
    const sooner = codeExpiring(NOW + 1 * DAY); // live but does NOT last longer
    const { pool, replaceCalls, deleteCalls } = makePool({
      candidatesByHost: { "home.example": [{ code: sooner }] },
      directoryByHost: { "home.example": { candidate_id: "cand-1", code: soon } },
      joined: [joined("home.example")],
    });
    const probe = probeReturning({ [sooner]: "live", [soon]: "live" });

    const result = await refreshStaleInvites({ now: NOW, pool, privateKey: KEY, probe });

    expect(result).toMatchObject({ expiringNoCandidate: 1, replaced: 0 });
    expect(replaceCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0); // the not-better candidate is left intact
  });

  it("leaves a live code with plenty of runway untouched", async () => {
    const far = codeExpiring(NOW + 60 * DAY);
    const { pool } = makePool({
      candidatesByHost: { "home.example": [{ code: codeExpiring(NOW + 90 * DAY) }] },
      directoryByHost: { "home.example": { candidate_id: "cand-1", code: far } },
      joined: [joined("home.example")],
    });
    const probe = probeReturning({ [far]: "live" });

    const result = await refreshStaleInvites({ now: NOW, pool, privateKey: KEY, probe });

    expect(result).toMatchObject({ expiringNoCandidate: 0, live: 1, replaced: 0 });
    // A comfortable code never even probes its candidates.
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("does not count a community without a directory invite", async () => {
    const { pool } = makePool({
      directoryByHost: { "home.example": { candidate_id: "cand-1", code: "LIVE" } },
      joined: [joined("home.example"), joined("nodir.example")],
    });
    const probe = probeReturning({ LIVE: "live" });

    const result = await refreshStaleInvites({ pool, privateKey: KEY, probe });

    expect(result.checked).toBe(1);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("isolates a per-community probe failure and keeps going", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { pool } = makePool({
      directoryByHost: {
        "bad.example": { candidate_id: "cand-bad", code: "BAD" },
        "good.example": { candidate_id: "cand-good", code: "GOOD" },
      },
      joined: [joined("bad.example"), joined("good.example")],
    });
    const probe: ProbeInviteFn = vi.fn(async ({ host, code }) => {
      if (host === "bad.example") throw new Error("probe exploded");
      return code === "GOOD" ? "live" : "error";
    });

    const result = await refreshStaleInvites({ pool, privateKey: KEY, probe });

    expect(result).toMatchObject({ checked: 2, errors: 1, live: 1 });
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("bad.example");
  });

  it("counts a probe error verdict as an error without swapping", async () => {
    const { pool, replaceCalls } = makePool({
      directoryByHost: { "home.example": { candidate_id: "cand-1", code: "X" } },
      joined: [joined("home.example")],
    });
    const probe = probeReturning({ X: "error" });

    const result = await refreshStaleInvites({ pool, privateKey: KEY, probe });

    expect(result).toMatchObject({ checked: 1, errors: 1, replaced: 0 });
    expect(replaceCalls).toHaveLength(0);
  });
});

describe("registerRefreshInvitesWorker", () => {
  it("registers on the refresh-invites queue with a single-batch worker", async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    const boss = { work } as unknown as PgBoss;
    const { pool } = makePool({ directoryByHost: {}, joined: [] });

    await registerRefreshInvitesWorker(boss, pool);

    expect(work).toHaveBeenCalledWith(
      REFRESH_INVITES_QUEUE,
      { batchSize: 1 },
      expect.any(Function),
    );
  });
});
