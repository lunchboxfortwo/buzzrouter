import type { Pool } from "pg";

const REQUIRED_TABLES = [
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
  "community_connections",
  "shared_channels",
  "shared_channel_endpoints",
  "bridge_messages",
  "bridge_deliveries",
  "bridge_event_mappings",
] as const;

export interface DiscoveryDatabaseReadiness {
  migration: string;
  migrations: string[];
  tables: string[];
}

export async function assertDiscoveryDatabaseReady(
  pool: Pool,
): Promise<DiscoveryDatabaseReadiness> {
  const tableResult = await pool.query<{
    community_candidates: string | null;
    community_sources: string | null;
    probe_snapshots: string | null;
    discovery_source_state: string | null;
    communities: string | null;
    claim_challenges: string | null;
    community_claims: string | null;
    nostr_auth_events: string | null;
    community_icons: string | null;
    community_reliability_metrics: string | null;
    community_connections: string | null;
    shared_channels: string | null;
    shared_channel_endpoints: string | null;
    bridge_messages: string | null;
    bridge_deliveries: string | null;
    bridge_event_mappings: string | null;
    migrations: string | null;
  }>(`
    SELECT
      to_regclass('public.community_candidates')::text
        AS community_candidates,
      to_regclass('public.community_sources')::text
        AS community_sources,
      to_regclass('public.probe_snapshots')::text
        AS probe_snapshots,
      to_regclass('public.discovery_source_state')::text
        AS discovery_source_state,
      to_regclass('public.communities')::text
        AS communities,
      to_regclass('public.claim_challenges')::text
        AS claim_challenges,
      to_regclass('public.community_claims')::text
        AS community_claims,
      to_regclass('public.nostr_auth_events')::text
        AS nostr_auth_events,
      to_regclass('public.community_icons')::text
        AS community_icons,
      to_regclass('public.community_reliability_metrics')::text
        AS community_reliability_metrics,
      to_regclass('public.community_connections')::text
        AS community_connections,
      to_regclass('public.shared_channels')::text
        AS shared_channels,
      to_regclass('public.shared_channel_endpoints')::text
        AS shared_channel_endpoints,
      to_regclass('public.bridge_messages')::text
        AS bridge_messages,
      to_regclass('public.bridge_deliveries')::text
        AS bridge_deliveries,
      to_regclass('public.bridge_event_mappings')::text
        AS bridge_event_mappings,
      to_regclass('public.buzzrouter_schema_migrations')::text
        AS migrations
  `);
  const tables = tableResult.rows[0];

  if (
    !tables ||
    !tables.migrations ||
    REQUIRED_TABLES.some((table) => !tables[table])
  ) {
    throw new Error(
      "Discovery database is not migrated. Run npm run db:migrate.",
    );
  }

  // The deploy gate asserts every migration file in the deploying revision has
  // been applied here, so expose the full applied set — not just the newest
  // name, which goes stale the moment a concurrent commit lands a higher one.
  const migrationResult = await pool.query<{ name: string }>(
    `
      SELECT name
      FROM buzzrouter_schema_migrations
      ORDER BY name ASC
    `,
  );
  const migrations = migrationResult.rows.map((row) => row.name);
  const migration = migrations.at(-1);
  if (!migration) {
    throw new Error(
      "Discovery database has no applied migration. Run npm run db:migrate.",
    );
  }

  return {
    migration,
    migrations,
    tables: [...REQUIRED_TABLES],
  };
}
