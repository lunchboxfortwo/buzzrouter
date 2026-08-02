import { getFunnelRollup } from "../src/db/funnel";
import { createDatabasePool } from "../src/db/pool";

// Read Layer-1 funnel data: join-affordance clicks over the last N days
// (default 7). Usage: `npm run funnel:status [days]`.
const pool = createDatabasePool();
try {
  const windowDays = Number(process.argv[2]) || 7;
  console.log(JSON.stringify(await getFunnelRollup(pool, windowDays), null, 2));
} finally {
  await pool.end();
}
