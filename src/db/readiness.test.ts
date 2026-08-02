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
            nostr_auth_events: "nostr_auth_events",
            community_icons: "community_icons",
            community_reliability_metrics: "community_reliability_metrics",
            community_connections: "community_connections",
            shared_channels: "shared_channels",
            shared_channel_endpoints: "shared_channel_endpoints",
            bridge_messages: "bridge_messages",
            bridge_deliveries: "bridge_deliveries",
            bridge_event_mappings: "bridge_event_mappings",
            migrations: "buzzrouter_schema_migrations",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { name: "0001_discovery.sql" },
          { name: "0002_source_discovery.sql" },
        ],
      });
    const pool = { query } as unknown as Pool;

    await expect(assertDiscoveryDatabaseReady(pool)).resolves.toEqual({
      migration: "0002_source_discovery.sql",
      migrations: ["0001_discovery.sql", "0002_source_discovery.sql"],
      tables: [
        "community_candidates",
        "community_sources",
        "probe_snapshots",
        "discovery_source_state",
        "communities",
        "nostr_auth_events",
        "community_icons",
        "community_reliability_metrics",
        "community_connections",
        "shared_channels",
        "shared_channel_endpoints",
        "bridge_messages",
        "bridge_deliveries",
        "bridge_event_mappings",
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
            nostr_auth_events: null,
            community_icons: null,
            community_reliability_metrics: null,
            community_connections: null,
            shared_channels: null,
            shared_channel_endpoints: null,
            bridge_messages: null,
            bridge_deliveries: null,
            bridge_event_mappings: null,
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
