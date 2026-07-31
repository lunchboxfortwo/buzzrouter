import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  deleteInviteCandidate,
  getDirectoryInvite,
  listInviteCandidates,
  listJoinedCommunities,
  replaceDirectoryInvite,
} from "../db/presence";
import { loadAgentIdentity } from "../presence/identity";
import {
  probeInvite as defaultProbeInvite,
  type InviteHealth,
  type ProbeInviteOptions,
} from "../presence/probe-invite";
import { REFRESH_INVITES_QUEUE } from "./queues";

/**
 * Keeps the invite the public directory serves for each joined community LIVE.
 *
 * The BuzzRouter Agent is a member of the communities it lists, so it can probe
 * a directory invite non-consumingly (see `probeInvite`). For every joined
 * community that has a directory invite, this job probes the current code:
 *
 *   - "live"              → nothing to do.
 *   - "expired"/"invalid" → probe the harvested fresh-invite candidates in
 *     recency order; on the first LIVE candidate, swap it into the directory
 *     (`replaceDirectoryInvite`) and drop the consumed candidate. If none are
 *     live the community is left as-is (still stale) for a future pass.
 *   - "error"             → transient; skip and retry next pass.
 *
 * Every community is processed under its own try/catch so one failure never
 * aborts the batch, and only the bare relay host (never an invite code) is
 * logged.
 */

export type ProbeInviteFn = (
  options: ProbeInviteOptions,
) => Promise<InviteHealth>;

export interface RefreshInvitesDeps {
  pool: Pool;
  /** Injectable invite probe; defaults to the real non-consuming claim probe. */
  probe?: ProbeInviteFn;
  /** Agent private key; defaults to the loaded agent identity's key. */
  privateKey?: Uint8Array;
}

export interface RefreshInvitesResult {
  checked: number;
  live: number;
  replaced: number;
  stillStale: number;
  errors: number;
}

export async function refreshStaleInvites(
  deps: RefreshInvitesDeps,
): Promise<RefreshInvitesResult> {
  const probe = deps.probe ?? defaultProbeInvite;
  const privateKey = deps.privateKey ?? loadAgentIdentity().privateKey;

  const result: RefreshInvitesResult = {
    checked: 0,
    errors: 0,
    live: 0,
    replaced: 0,
    stillStale: 0,
  };

  const communities = await listJoinedCommunities(deps.pool);

  for (const community of communities) {
    const host = community.relayHost;
    try {
      const directory = await getDirectoryInvite(deps.pool, host);
      if (!directory) continue;

      result.checked += 1;
      const health = await probe({ code: directory.code, host, privateKey });
      if (health === "live") {
        result.live += 1;
        continue;
      }
      if (health === "error") {
        result.errors += 1;
        continue;
      }

      // The directory's invite is stale — try each harvested candidate until
      // one probes LIVE, then swap it in and consume it.
      const candidates = await listInviteCandidates(deps.pool, host);
      let swapped = false;
      for (const candidate of candidates) {
        const candidateHealth = await probe({
          code: candidate.code,
          host,
          privateKey,
        });
        if (candidateHealth === "live") {
          await replaceDirectoryInvite(
            deps.pool,
            directory.candidateId,
            candidate.code,
          );
          await deleteInviteCandidate(deps.pool, host, candidate.code);
          result.replaced += 1;
          swapped = true;
          break;
        }
      }

      if (!swapped) {
        result.stillStale += 1;
        console.warn(
          `${REFRESH_INVITES_QUEUE}: no live invite for ${host} (${health})`,
        );
      }
    } catch (error) {
      result.errors += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`${REFRESH_INVITES_QUEUE}: failed ${host}: ${reason}`);
    }
  }

  return result;
}

/**
 * Registers the pg-boss worker that drains the invite-freshness schedule.
 * Mirrors `registerHarvestInvitesWorker`: a single-batch worker that runs one
 * freshness pass per fired job.
 */
export async function registerRefreshInvitesWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(REFRESH_INVITES_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const _job of jobs) {
      const tally = await refreshStaleInvites({ pool });
      console.log(
        `${REFRESH_INVITES_QUEUE}: checked=${tally.checked} ` +
          `live=${tally.live} replaced=${tally.replaced} ` +
          `stillStale=${tally.stillStale} errors=${tally.errors}`,
      );
    }
  });
}
