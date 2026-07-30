import { afterEach, describe, expect, it } from "vitest";

import { getDatabaseConnectionOptions } from "./pool";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDatabaseSsl = process.env.DATABASE_SSL;

afterEach(() => {
  restoreEnvironment("DATABASE_URL", originalDatabaseUrl);
  restoreEnvironment("DATABASE_SSL", originalDatabaseSsl);
});

describe("getDatabaseConnectionOptions", () => {
  it("shares strict TLS settings with every PostgreSQL client", () => {
    process.env.DATABASE_URL = "postgresql://database.example.com/buzzrouter";
    process.env.DATABASE_SSL = "true";

    expect(getDatabaseConnectionOptions("test-client")).toEqual({
      application_name: "test-client",
      connectionString: "postgresql://database.example.com/buzzrouter",
      ssl: { rejectUnauthorized: true },
    });
  });

  it("does not silently invent a database URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => getDatabaseConnectionOptions("test-client")).toThrow(
      "DATABASE_URL is required",
    );
  });
});

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
