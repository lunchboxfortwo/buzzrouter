import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { listDirectoryCommunities } from "./directory";

describe("listDirectoryCommunities", () => {
  it("maps verified relay evidence into the public directory contract", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          auth_required: true,
          adoption_pubkeys: 0,
          adoption_repos: 2,
          corroboration_sources: 3,
          display_name_override: null,
          evidence_sufficient: true,
          first_seen_at: new Date("2026-01-01T00:00:00Z"),
          focus: "ai-agents",
          metadata_changed_at: null,
          probes_successful: 29,
          probes_total: 30,
          reliability_score: "72.50",
          candidate_id: "candidate-1",
          canonical_relay_url: "wss://builders.example",
          categories: ["Builders"],
          claimed: false,
          description: "A public relay description.",
          display_name: "Builders",
          evidence_count: "2",
          has_icon: true,
          public_url: null,
          invite_code: null,
          join_mode: null,
          join_url: null,
          last_verified_at: new Date("2026-07-30T12:00:00Z"),
          relay_host: "builders.example",
          slug: null,
          software_version: "0.9.0",
          source_types: ["github", "nip66"],
          supported_nips: [11, 29, 42],
          ws_open_ms: 83,
          tagline: null,
          active_member_count: null,
          total_member_count: null,
          activity_level: null,
          message_count: null,
          activity_window_days: null,
          recent_projects: null,
          last_summarized_at: null,
        },
      ],
    });
    const pool = { query } as unknown as Pool;

    await expect(
      listDirectoryCommunities(pool, {
        limit: 20,
        category: "builders",
        search: "builders",
        sort: "recent",
      }),
    ).resolves.toEqual([
      {
        authRequired: true,
        adoptionPubkeys: 0,
        adoptionRepos: 2,
        corroborationSources: 3,
        evidenceSufficient: true,
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        focus: "ai-agents",
        metadataChangedAt: null,
        probesSuccessful: 29,
        probesTotal: 30,
        reliabilityScore: 72.5,
        candidateId: "candidate-1",
        canonicalRelayUrl: "wss://builders.example",
        categories: ["Builders"],
        claimed: false,
        description: "A public relay description.",
        displayName: "Builders",
        evidenceCount: 2,
        iconUrl: "/api/community-icons/candidate-1",
        publicUrl: null,
        inviteCode: null,
        joinMode: null,
        joinUrl: null,
        lastVerifiedAt: "2026-07-30T12:00:00.000Z",
        relayHost: "builders.example",
        slug: null,
        softwareVersion: "0.9.0",
        sourceTypes: ["github", "nip66"],
        supportedNips: [11, 29, 42],
        tagline: null,
        websocketOpenMs: 83,
        activeMemberCount: null,
        totalMemberCount: null,
        activityLevel: null,
        messageCount: null,
        activityWindowDays: null,
        recentProjects: [],
        lastSummarizedAt: null,
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("last_verified_at DESC"),
      ["builders", "builders", 20],
    );
    expect(query.mock.calls[0]?.[0]).not.toContain(
      "relay_host ILIKE",
    );
    expect(query.mock.calls[0]?.[0]).toContain("unnest(categories)");
  });

  it.each([0, 201, 1.5])("rejects unsafe limit %s", async (limit) => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(
      listDirectoryCommunities(pool, { limit }),
    ).rejects.toThrow("between 1 and 200");
  });
});
