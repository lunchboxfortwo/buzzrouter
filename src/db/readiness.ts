import type { Pool } from "pg";

const REQUIRED_TABLES = [
  "community_candidates",
  "community_sources",
  "probe_snapshots",
  "discovery_source_state",
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
