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

    const result = await refreshCommunitySummaries({
      buildSummary,
      pool,
      readCommunity,
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

  it("returns a zero tally when nothing is joined", async () => {
    const { pool } = poolWith([]);
    await expect(
      refreshCommunitySummaries({
        buildSummary: vi.fn(),
        pool,
        readCommunity: vi.fn(),
      }),
    ).resolves.toEqual({ failed: 0, ok: 0 });
  });
});
