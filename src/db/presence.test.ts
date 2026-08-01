import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { CommunitySummary } from "../presence/summarize";
import {
  deleteInviteCandidate,
  getDirectoryInvite,
  listInviteCandidates,
  listJoinedCommunities,
  recordPresenceFocus,
  replaceDirectoryInvite,
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

describe("getDirectoryInvite", () => {
  it("resolves the newest non-null directory invite by relay host", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ candidate_id: "cand-1", code: "INV-CODE" }],
    });
    const pool = { query } as unknown as Pool;

    await expect(getDirectoryInvite(pool, "builders.example")).resolves.toEqual({
      candidateId: "cand-1",
      code: "INV-CODE",
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    // Matched against the canonical wss:// relay URL, newest source first.
    expect(sql).toContain("cc.canonical_relay_url = $1");
    expect(sql).toContain("cs.source_invite_code IS NOT NULL");
    expect(sql).toContain("ORDER BY cs.last_seen_at DESC");
    expect(params).toEqual(["wss://builders.example"]);
  });

  it("returns null when the directory has no invite for the host", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    await expect(getDirectoryInvite(pool, "builders.example")).resolves.toBeNull();
  });
});

describe("listInviteCandidates", () => {
  it("lists harvested candidate codes newest seen_at first", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ code: "C2" }, { code: "C1" }],
    });
    const pool = { query } as unknown as Pool;

    await expect(
      listInviteCandidates(pool, "builders.example"),
    ).resolves.toEqual([{ code: "C2" }, { code: "C1" }]);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM harvested_invite_candidates");
    expect(sql).toContain("ORDER BY seen_at DESC");
    expect(params).toEqual(["builders.example"]);
  });
});

describe("replaceDirectoryInvite", () => {
  it("updates only source_invite_code for the candidate's source rows", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await replaceDirectoryInvite(pool, "cand-1", "FRESH");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE community_sources");
    expect(sql).toContain("source_invite_code = $2");
    // The code must never land in source_locator (the no-invites CHECK).
    expect(sql).not.toContain("source_locator");
    expect(params).toEqual(["cand-1", "FRESH"]);
  });
});

describe("deleteInviteCandidate", () => {
  it("deletes the consumed candidate by (relay_host, code)", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await deleteInviteCandidate(pool, "builders.example", "FRESH");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("DELETE FROM harvested_invite_candidates");
    expect(params).toEqual(["builders.example", "FRESH"]);
  });
});

describe("recordPresenceFocus", () => {
  it("upserts communities.focus from the candidate matched by host, source 'presence'", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await recordPresenceFocus(pool, "builders.example", "building");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO communities");
    // Resolves candidate_id by host rather than trusting a caller-supplied id.
    expect(sql).toContain("FROM community_candidates");
    expect(sql).toContain("WHERE host = $1");
    expect(sql).toContain("'presence'");
    // Precedence guard: only overwrite machine-set focus, never operator/confirmed.
    expect(sql).toContain("communities.focus_source IS NULL");
    expect(sql).toContain("communities.focus_source IN ('classified', 'presence')");
    expect(sql).not.toContain("operator");
    expect(params).toEqual(["builders.example", "building"]);
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
      focus: "building",
      goals: "Build things",
      messageCount: 40,
      recentProjects: ["Relay work", "Docs"],
      tagline: "Builder guild HQ",
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
      "Builder guild HQ",
    ]);
  });

  it("stores null total_member_count when the roster size is unknown", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await upsertSummary(pool, "builders.example", {
      activeMemberCount: 0,
      activityLevel: "quiet",
      channelCount: 0,
      focus: null,
      goals: "Too quiet to tell.",
      messageCount: 0,
      recentProjects: [],
      tagline: null,
      windowDays: 7,
    });

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[5]).toBeNull();
    expect(params[2]).toBe("[]");
  });
});
