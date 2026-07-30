import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Pool } from "pg";

const MIGRATION_LOCK_ID = 1_923_746_111;

export async function runMigrations(
  pool: Pool,
  migrationsDirectory = path.join(process.cwd(), "migrations"),
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS buzzrouter_schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const existing = await client.query<{ name: string }>(
      "SELECT name FROM buzzrouter_schema_migrations",
    );
    const appliedNames = new Set(existing.rows.map((row) => row.name));

    for (const file of files) {
      if (appliedNames.has(file)) {
        continue;
      }

      const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO buzzrouter_schema_migrations (name) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    client.release();
  }

  return applied;
}
