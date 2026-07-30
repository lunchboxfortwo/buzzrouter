import { createDatabasePool } from "../src/db/pool";
import { assertDiscoveryDatabaseReady } from "../src/db/readiness";

const pool = createDatabasePool();

try {
  const readiness = await assertDiscoveryDatabaseReady(pool);
  console.log(
    JSON.stringify(
      {
        ok: true,
        migration: readiness.migration,
        requiredTables: readiness.tables,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
