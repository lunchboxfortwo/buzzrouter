import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "./migrations";

describe("runMigrations", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "buzzrouter-migrations-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("applies timestamp-prefixed files after zero-padded numeric ones, in filename order", async () => {
    // Timestamp prefixes (e.g. 20260731T2130_name.sql) must sort lexically
    // after every legacy 000N_name.sql file, since '2' > '0' as characters.
    // This is what lets new migrations avoid colliding on a shared counter.
    const files = [
      "0002_second.sql",
      "20260731T2130_late.sql",
      "0001_first.sql",
      "20260701T0000_earlier_timestamp.sql",
    ];

    for (const file of files) {
      await writeFile(path.join(dir, file), "SELECT 1;");
    }

    const applied: string[] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith("INSERT INTO buzzrouter_schema_migrations")) {
          applied.push((params as string[])[0]);
        }
        if (sql.startsWith("SELECT name FROM")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {},
    };
    const pool = {
      connect: async () => client,
    } as unknown as Pool;

    const result = await runMigrations(pool, dir);

    expect(result).toEqual([
      "0001_first.sql",
      "0002_second.sql",
      "20260701T0000_earlier_timestamp.sql",
      "20260731T2130_late.sql",
    ]);
    expect(applied).toEqual(result);
  });
});
