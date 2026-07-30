import { Pool } from "pg";

let sharedPool: Pool | undefined;

export function getDatabasePool(): Pool {
  if (!sharedPool) {
    sharedPool = createDatabasePool();
  }

  return sharedPool;
}

export function createDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const ssl =
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined;

  return new Pool({
    application_name: "buzzrouter",
    connectionString,
    max: 10,
    ssl,
  });
}
