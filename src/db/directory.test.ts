import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { listDirectoryCommunities } from "./directory";

describe("listDirectoryCommunities", () => {
  it("maps verified relay evidence into the public directory contract", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          auth_required: true,
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
        authRequired: true,
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

  it.each([0, 201, 1.5])("rejects unsafe limit %s", async (limit) => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(
      listDirectoryCommunities(pool, { limit }),
    ).rejects.toThrow("between 1 and 200");
  });
});
