import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { CommunitySummary } from "../presence/summarize";
import {
  listJoinedCommunities,
  upsertMembership,
  upsertSummary,
} from "./presence";

describe("upsertMembership", () => {
  it("inserts a membership and preserves joined_at on conflict", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await upsertMembership(pool, {
      communityId: "11111111-1111-1111-1111-111111111111",
      relayHost: "builders.example",
      relayUrl: "wss://builders.example",
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT (relay_host)");
    // joined_at must never appear in the UPDATE set so the first join sticks.
    expect(sql).not.toContain("joined_at =");
    expect(sql).toContain("COALESCE(EXCLUDED.community_id");
    expect(params).toEqual([
      "builders.example",
      "wss://builders.example",
      "11111111-1111-1111-1111-111111111111",
    ]);
  });

  it("passes null when no communityId is supplied", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await upsertMembership(pool, {
      relayHost: "builders.example",
      relayUrl: "wss://builders.example",
    });

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      "builders.example",
      "wss://builders.example",
      null,
    ]);
  });
});

describe("listJoinedCommunities", () => {
  it("maps rows to the camelCase membership shape", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          community_id: "c1",
          relay_host: "a.example",
          relay_url: "wss://a.example",
        },
        {
          community_id: null,
          relay_host: "b.example",
          relay_url: "wss://b.example",
        },
      ],
    });
    const pool = { query } as unknown as Pool;

    await expect(listJoinedCommunities(pool)).resolves.toEqual([
      { communityId: "c1", relayHost: "a.example", relayUrl: "wss://a.example" },
      {
        communityId: null,
        relayHost: "b.example",
        relayUrl: "wss://b.example",
      },
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY joined_at ASC");
  });
});

describe("upsertSummary", () => {
  it("writes the summary columns with recentProjects serialized as jsonb", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    const summary: CommunitySummary = {
      activeMemberCount: 5,
      activityLevel: "active",
      channelCount: 3,
      goals: "Build things",
      messageCount: 40,
      recentProjects: ["Relay work", "Docs"],
      totalMemberCount: 12,
      windowDays: 7,
    };

    await upsertSummary(pool, "builders.example", summary);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE presence_communities");
    expect(sql).toContain("last_summarized_at = now()");
    expect(params).toEqual([
      "builders.example",
      "Build things",
      '["Relay work","Docs"]',
      "active",
      5,
      12,
      40,
      3,
      7,
    ]);
  });

  it("stores null total_member_count when the roster size is unknown", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await upsertSummary(pool, "builders.example", {
      activeMemberCount: 0,
      activityLevel: "quiet",
      channelCount: 0,
      goals: "Too quiet to tell.",
      messageCount: 0,
      recentProjects: [],
      windowDays: 7,
    });

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[5]).toBeNull();
    expect(params[2]).toBe("[]");
  });
});
