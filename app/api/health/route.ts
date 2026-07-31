import { getDatabasePool } from "../../../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../../../src/db/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const readiness = await assertDiscoveryDatabaseReady(getDatabasePool());
    return Response.json(
      {
        migration: readiness.migration,
        migrations: readiness.migrations,
        release: process.env.APP_RELEASE_SHA ?? "unknown",
        status: "ok",
      },
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      {
        headers: { "cache-control": "no-store" },
        status: 503,
      },
    );
  }
}
