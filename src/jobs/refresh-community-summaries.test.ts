import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PresenceMessage } from "../presence/reader";
import type { CommunitySummary } from "../presence/summarize";
import { refreshCommunitySummaries } from "./refresh-community-summaries";

function summary(overrides: Partial<CommunitySummary> = {}): CommunitySummary {
  return {
    activeMemberCount: 2,
    activityLevel: "light",
    channelCount: 1,
    focus: null,
    goals: "Build things",
    messageCount: 4,
    recentProjects: ["Relay work"],
    windowDays: 7,
    ...overrides,
  };
}

/** A pool whose `query` returns the given membership rows for the SELECT and
 * an empty result for the summary UPDATEs, recording every call. */
function poolWith(
  rows: { relay_host: string; relay_url: string; community_id: string | null }[],
): { pool: Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (sql: string) => {
    if (/SELECT/i.test(sql)) return { rows };
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, query };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refreshCommunitySummaries", () => {
  it("reads, summarizes, and upserts every joined community (happy path)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool, query } = poolWith([
      { community_id: "c1", relay_host: "a.example", relay_url: "wss://a.example" },
      { community_id: "c2", relay_host: "b.example", relay_url: "wss://b.example" },
    ]);

    const messages: PresenceMessage[] = [];
    const readCommunity = vi.fn(async () => messages);
    const buildSummary = vi.fn(async () => summary());
    const readMemberCount = vi.fn(async () => 5);

    const result = await refreshCommunitySummaries({
      buildSummary,
      pool,
      readCommunity,
      readMemberCount,
    });

    expect(result).toEqual({ failed: 0, ok: 2 });
    expect(readCommunity).toHaveBeenCalledWith({ relayUrl: "wss://a.example" });
    expect(readCommunity).toHaveBeenCalledWith({ relayUrl: "wss://b.example" });
    // One SELECT + one UPDATE per community.
    const updates = query.mock.calls.filter(([sql]) =>
      /UPDATE presence_communities/.test(sql as string),
    );
    expect(updates).toHaveLength(2);
    expect(updates[0]?.[1]?.[0]).toBe("a.example");
    expect(updates[1]?.[1]?.[0]).toBe("b.example");
    // Roster (5) >= active (2) → surfaced as total_member_count (param $6).
    expect(updates[0]?.[1]?.[5]).toBe(5);
  });

  it("skips the focus write when the classification is null", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool } = poolWith([
      { community_id: null, relay_host: "none.example", relay_url: "wss://none.example" },
    ]);
    const recordFocus = vi.fn(async () => undefined);

    await refreshCommunitySummaries({
      buildSummary: vi.fn(async () => summary({ focus: null })),
      pool,
      readCommunity: vi.fn(async () => [] as PresenceMessage[]),
      readMemberCount: vi.fn(async () => 0),
      recordFocus,
    });

    expect(recordFocus).not.toHaveBeenCalled();
  });

  it("writes the presence focus for a community the agent classified", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool } = poolWith([
      { community_id: null, relay_host: "ai.example", relay_url: "wss://ai.example" },
    ]);
    const recordFocus = vi.fn(async () => undefined);

    await refreshCommunitySummaries({
      buildSummary: vi.fn(async () => summary({ focus: "ai-agents" })),
      pool,
      readCommunity: vi.fn(async () => [] as PresenceMessage[]),
      readMemberCount: vi.fn(async () => 0),
      recordFocus,
    });

    expect(recordFocus).toHaveBeenCalledTimes(1);
    expect(recordFocus).toHaveBeenCalledWith("ai.example", "ai-agents");
  });

  it("still succeeds when the focus write fails (best-effort)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { pool } = poolWith([
      { community_id: null, relay_host: "ai.example", relay_url: "wss://ai.example" },
    ]);

    const result = await refreshCommunitySummaries({
      buildSummary: vi.fn(async () => summary({ focus: "building" })),
      pool,
      readCommunity: vi.fn(async () => [] as PresenceMessage[]),
      readMemberCount: vi.fn(async () => 0),
      recordFocus: vi.fn(async () => {
        throw new Error("focus write boom");
      }),
    });

    expect(result).toEqual({ failed: 0, ok: 1 });
  });

  it("isolates a failing community so the others still succeed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { pool, query } = poolWith([
      { community_id: null, relay_host: "ok.example", relay_url: "wss://ok.example" },
      {
        community_id: null,
        relay_host: "bad.example",
        relay_url: "wss://bad.example",
      },
    ]);

    const readCommunity = vi.fn(async ({ relayUrl }: { relayUrl: string }) => {
      if (relayUrl === "wss://bad.example") {
        throw new Error("relay unreachable");
      }
      return [] as PresenceMessage[];
    });
    const buildSummary = vi.fn(async () => summary());

    const result = await refreshCommunitySummaries({
      buildSummary,
      pool,
      readCommunity,
      readMemberCount: vi.fn(async () => 3),
    });

    expect(result).toEqual({ failed: 1, ok: 1 });
    // Only the healthy community was upserted.
    const updates = query.mock.calls.filter(([sql]) =>
      /UPDATE presence_communities/.test(sql as string),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.[1]?.[0]).toBe("ok.example");
    // The failure is logged with the host but nothing secret.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("bad.example");
  });

  it("omits the total when the visible roster is smaller than the active count", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool, query } = poolWith([
      { community_id: null, relay_host: "a.example", relay_url: "wss://a.example" },
    ]);

    const result = await refreshCommunitySummaries({
      buildSummary: vi.fn(async () => summary({ activeMemberCount: 5 })),
      pool,
      readCommunity: vi.fn(async () => [] as PresenceMessage[]),
      readMemberCount: vi.fn(async () => 3),
    });

    expect(result).toEqual({ failed: 0, ok: 1 });
    const updates = query.mock.calls.filter(([sql]) =>
      /UPDATE presence_communities/.test(sql as string),
    );
    // Roster (3) < active (5) → total omitted rather than a nonsensical "5 of 3".
    expect(updates[0]?.[1]?.[5]).toBeNull();
  });

  it("still upserts when the roster read fails (best-effort total)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { pool, query } = poolWith([
      { community_id: null, relay_host: "a.example", relay_url: "wss://a.example" },
    ]);

    const result = await refreshCommunitySummaries({
      buildSummary: vi.fn(async () => summary()),
      pool,
      readCommunity: vi.fn(async () => [] as PresenceMessage[]),
      readMemberCount: vi.fn(async () => {
        throw new Error("roster unreachable");
      }),
    });

    expect(result).toEqual({ failed: 0, ok: 1 });
    const updates = query.mock.calls.filter(([sql]) =>
      /UPDATE presence_communities/.test(sql as string),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.[1]?.[5]).toBeNull();
  });

  it("returns a zero tally when nothing is joined", async () => {
    const { pool } = poolWith([]);
    await expect(
      refreshCommunitySummaries({
        buildSummary: vi.fn(),
        pool,
        readCommunity: vi.fn(),
        readMemberCount: vi.fn(),
      }),
    ).resolves.toEqual({ failed: 0, ok: 0 });
  });
});
