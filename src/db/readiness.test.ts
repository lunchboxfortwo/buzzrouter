import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { assertDiscoveryDatabaseReady } from "./readiness";

describe("assertDiscoveryDatabaseReady", () => {
  it("returns the current migration when required tables exist", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            community_candidates: "community_candidates",
            community_sources: "community_sources",
            probe_snapshots: "probe_snapshots",
            discovery_source_state: "discovery_source_state",
            communities: "communities",
            claim_challenges: "claim_challenges",
            community_claims: "community_claims",
            nostr_auth_events: "nostr_auth_events",
            community_icons: "community_icons",
            community_reliability_metrics: "community_reliability_metrics",
            migrations: "buzzrouter_schema_migrations",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ name: "0001_discovery.sql" }],
      });
    const pool = { query } as unknown as Pool;

    await expect(assertDiscoveryDatabaseReady(pool)).resolves.toEqual({
      migration: "0001_discovery.sql",
      tables: [
        "community_candidates",
        "community_sources",
        "probe_snapshots",
        "discovery_source_state",
        "communities",
        "claim_challenges",
        "community_claims",
        "nostr_auth_events",
        "community_icons",
        "community_reliability_metrics",
      ],
    });
  });

  it("fails before the worker starts against an empty database", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            community_candidates: null,
            community_sources: null,
            probe_snapshots: null,
            discovery_source_state: null,
            communities: null,
            claim_challenges: null,
            community_claims: null,
            nostr_auth_events: null,
            community_icons: null,
            migrations: null,
          },
        ],
      }),
    } as unknown as Pool;

    await expect(assertDiscoveryDatabaseReady(pool)).rejects.toThrow(
      "npm run db:migrate",
    );
  });
});
