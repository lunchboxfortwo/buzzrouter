import { Pool } from "pg";

let sharedPool: Pool | undefined;

export interface DatabaseConnectionOptions {
  application_name: string;
  connectionString: string;
  ssl?: {
    rejectUnauthorized: true;
  };
}

export function getDatabasePool(): Pool {
  if (!sharedPool) {
    sharedPool = createDatabasePool();
  }

  return sharedPool;
}

export function createDatabasePool(): Pool {
  const options = getDatabaseConnectionOptions("buzzrouter");

  return new Pool({
    ...options,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
}

export function getDatabaseConnectionOptions(
  applicationName: string,
): DatabaseConnectionOptions {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const ssl: DatabaseConnectionOptions["ssl"] =
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined;

  return {
    application_name: applicationName,
    connectionString,
    ssl,
  };
}
