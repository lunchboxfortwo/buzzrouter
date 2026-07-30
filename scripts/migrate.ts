import { createDatabasePool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrations";

const pool = createDatabasePool();

try {
  const applied = await runMigrations(pool);
  if (applied.length === 0) {
    console.log("Database schema is current.");
  } else {
    console.log(`Applied ${applied.length} migration(s): ${applied.join(", ")}`);
  }
} finally {
  await pool.end();
}
