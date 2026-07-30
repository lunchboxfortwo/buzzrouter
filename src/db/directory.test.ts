import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { listDirectoryCommunities } from "./directory";

describe("listDirectoryCommunities", () => {
  it("maps verified relay evidence into the public directory contract", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          activity_score: "72.50",
          adoption_pubkeys: 41,
          adoption_repos: 2,
          auth_required: true,
          evidence_sufficient: true,
          metadata_changed_at: new Date("2026-07-28T09:00:00Z"),
          probes_successful: 29,
          probes_total: 30,
          candidate_id: "candidate-1",
          canonical_relay_url: "wss://builders.example",
          categories: ["Builders"],
          claimed: false,
          description: "A public relay description.",
          display_name: "Builders",
          evidence_count: "2",
          join_mode: null,
          join_url: null,
          last_verified_at: new Date("2026-07-30T12:00:00Z"),
          relay_host: "builders.example",
          slug: null,
          software_version: "0.9.0",
          source_types: ["github", "nip66"],
          supported_nips: [11, 29, 42],
          ws_open_ms: 83,
        },
      ],
    });
    const pool = { query } as unknown as Pool;

    await expect(
      listDirectoryCommunities(pool, {
        limit: 20,
        search: "builders",
        sort: "recent",
      }),
    ).resolves.toEqual([
      {
        activityScore: 72.5,
        adoptionPubkeys: 41,
        adoptionRepos: 2,
        authRequired: true,
        evidenceSufficient: true,
        metadataChangedAt: "2026-07-28T09:00:00.000Z",
        probesSuccessful: 29,
        probesTotal: 30,
        candidateId: "candidate-1",
        canonicalRelayUrl: "wss://builders.example",
        categories: ["Builders"],
        claimed: false,
        description: "A public relay description.",
        displayName: "Builders",
        evidenceCount: 2,
        joinMode: null,
        joinUrl: null,
        lastVerifiedAt: "2026-07-30T12:00:00.000Z",
        relayHost: "builders.example",
        slug: null,
        softwareVersion: "0.9.0",
        sourceTypes: ["github", "nip66"],
        supportedNips: [11, 29, 42],
        websocketOpenMs: 83,
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("last_verified_at DESC"),
      ["builders", 20],
    );
  });

  it("orders by activity with insufficient evidence last", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await listDirectoryCommunities(pool, { sort: "activity" });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("evidence_sufficient DESC, activity_score DESC"),
      ["", 100],
    );
  });

  it("defaults missing metrics to zero rather than null", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          activity_score: null,
          adoption_pubkeys: null,
          adoption_repos: null,
          auth_required: null,
          candidate_id: "candidate-2",
          canonical_relay_url: "wss://new.example",
          categories: [],
          claimed: false,
          description: null,
          display_name: "New",
          evidence_count: "1",
          evidence_sufficient: null,
          join_mode: null,
          join_url: null,
          last_verified_at: new Date("2026-07-30T12:00:00Z"),
          metadata_changed_at: null,
          probes_successful: null,
          probes_total: null,
          relay_host: "new.example",
          slug: null,
          software_version: null,
          source_types: ["nip65"],
          supported_nips: [],
          ws_open_ms: null,
        },
      ],
    });
    const pool = { query } as unknown as Pool;

    const [community] = await listDirectoryCommunities(pool);

    expect(community.activityScore).toBe(0);
    expect(community.adoptionPubkeys).toBe(0);
    expect(community.evidenceSufficient).toBe(false);
    expect(community.metadataChangedAt).toBeNull();
  });

  it.each([0, 201, 1.5])("rejects unsafe limit %s", async (limit) => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(
      listDirectoryCommunities(pool, { limit }),
    ).rejects.toThrow("between 1 and 200");
  });
});
