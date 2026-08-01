import { PgBoss } from "pg-boss";

import {
  getDatabaseConnectionOptions,
  getDatabasePool,
} from "./db/pool";
import { assertDiscoveryDatabaseReady } from "./db/readiness";
import { registerAutoJoinWorker } from "./jobs/auto-join-communities";
import { registerHarvestInvitesWorker } from "./jobs/harvest-invites";
import { registerHarvestXInvitesWorker } from "./jobs/harvest-x-invites";
import { registerProbeCandidateWorker } from "./jobs/probe-candidate";
import { registerProbeJoinabilityWorker } from "./jobs/probe-joinability";
import { registerRefreshSummariesWorker } from "./jobs/refresh-community-summaries";
import { registerRefreshInvitesWorker } from "./jobs/refresh-invites";
import { registerReliabilityRollupWorker } from "./jobs/reliability-rollup";
import { registerValidateSubmissionsPoller } from "./jobs/validate-submissions";
import {
  AUTO_JOIN_QUEUE,
  configureQueues,
  HARVEST_INVITES_QUEUE,
  PROBE_JOINABILITY_QUEUE,
  REFRESH_INVITES_QUEUE,
  REFRESH_SUMMARIES_QUEUE,
  SOURCE_X_QUEUE,
} from "./jobs/queues";
import { registerDueProbeScheduler } from "./jobs/schedule-due-probes";
import { registerSourceWorkers } from "./jobs/source-workers";
import {
  ConnectorSupervisor,
  createFileWrappingKeyProvider,
  registerBridgeDeliveryWorker,
} from "./shared-channels/connector";

// A long-running worker must not die on a stray promise rejection — e.g. the
// nostr-tools "relay connection closed by us" that fires as a presence read is
// torn down. Log and keep running instead of taking Node's default (crash).
process.on("unhandledRejection", (reason) => {
  console.error(
    "worker unhandledRejection (non-fatal):",
    reason instanceof Error ? reason.message : String(reason),
  );
});

const pool = getDatabasePool();
const boss = new PgBoss(
  getDatabaseConnectionOptions("buzzrouter-worker"),
);

boss.on("error", (error) => {
  console.error("pg-boss error", error);
});

let bossStarted = false;
let connectorSupervisor: ConnectorSupervisor | undefined;
let stopValidationPoller: (() => void) | undefined;
try {
  await assertDiscoveryDatabaseReady(pool);
  await boss.start();
  bossStarted = true;
  await configureQueues(boss);
  await registerProbeCandidateWorker(boss, pool);
  await registerDueProbeScheduler(boss, pool);
  await registerSourceWorkers(boss, pool);
  await registerReliabilityRollupWorker(boss, pool);
  await registerRefreshSummariesWorker(boss, pool);
  await registerAutoJoinWorker(boss, pool);
  await registerHarvestInvitesWorker(boss, pool);
  await registerHarvestXInvitesWorker(boss, pool);
  await registerRefreshInvitesWorker(boss, pool);
  await registerProbeJoinabilityWorker(boss, pool);
  // Settle synchronous invite validations from the submit flow: the web tier
  // (which has no agent key) inserts a pending row, this poller claims it and
  // joins with the invite to verify + admit the agent. Runs off pg-boss on a
  // short interval so the web request's brief wait usually resolves in-band.
  stopValidationPoller = registerValidateSubmissionsPoller(pool);
  // Kick one summary refresh on startup so a redeploy/restart populates
  // community summaries right away instead of waiting for the next 4h tick.
  // Best-effort: the job itself is per-community fault-tolerant, and a failed
  // enqueue must never take the worker down.
  try {
    await boss.send(REFRESH_SUMMARIES_QUEUE, null);
  } catch (error) {
    console.error("initial presence summary refresh enqueue failed", error);
  }
  // Kick one auto-join pass on startup so a redeploy joins every currently
  // listed joinable community immediately. Best-effort for the same reasons;
  // the worker itself chains a summary refresh when it joins anything new.
  try {
    await boss.send(AUTO_JOIN_QUEUE, null);
  } catch (error) {
    console.error("initial community auto-join enqueue failed", error);
  }
  // Kick one invite-harvest pass on startup so a redeploy scans channels for
  // fresh invites immediately. Best-effort for the same reasons; the worker
  // itself chains a summary refresh when it joins anything new.
  try {
    await boss.send(HARVEST_INVITES_QUEUE, null);
  } catch (error) {
    console.error("initial invite harvest enqueue failed", error);
  }
  // Kick one invite-freshness pass on startup so a redeploy re-probes every
  // directory invite and swaps in a live candidate immediately. Best-effort for
  // the same reasons as the other presence kicks above.
  try {
    await boss.send(REFRESH_INVITES_QUEUE, null);
  } catch (error) {
    console.error("initial invite freshness refresh enqueue failed", error);
  }
  // Kick one joinability-probe pass on startup so a redeploy re-verifies every
  // advertised invite code's claimability immediately. Best-effort for the same
  // reasons as the other kicks above.
  try {
    await boss.send(PROBE_JOINABILITY_QUEUE, null);
  } catch (error) {
    console.error("initial joinability probe enqueue failed", error);
  }
  // Kick one X invite search on startup when enabled so a redeploy picks up
  // public invite posts without waiting for the next 30m tick.
  try {
    await boss.send(SOURCE_X_QUEUE, null);
  } catch (error) {
    console.error("initial X invite harvest enqueue failed", error);
  }
  connectorSupervisor = new ConnectorSupervisor(
    pool,
    boss,
    createFileWrappingKeyProvider(),
  );
  await connectorSupervisor.start();
  await registerBridgeDeliveryWorker(boss, connectorSupervisor);
} catch (error) {
  await connectorSupervisor?.stop();
  if (bossStarted) {
    await boss.stop();
  }
  await pool.end();
  throw error;
}

async function shutdown(): Promise<void> {
  stopValidationPoller?.();
  await connectorSupervisor?.stop();
  await boss.stop({ graceful: true, timeout: 30_000 });
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});
