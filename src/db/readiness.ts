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
] as const;

export interface DiscoveryDatabaseReadiness {
  migration: string;
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

  const migrationResult = await pool.query<{ name: string }>(
    `
      SELECT name
      FROM buzzrouter_schema_migrations
      ORDER BY name DESC
      LIMIT 1
    `,
  );
  const migration = migrationResult.rows[0]?.name;
  if (!migration) {
    throw new Error(
      "Discovery database has no applied migration. Run npm run db:migrate.",
    );
  }

  return {
    migration,
    tables: [...REQUIRED_TABLES],
  };
}
