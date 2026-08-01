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
import { parseInviteExpiry } from "../presence/invite-expiry";
import {
  probeInvite as defaultProbeInvite,
  type InviteHealth,
  type ProbeInviteOptions,
} from "../presence/probe-invite";
import { REFRESH_INVITES_QUEUE } from "./queues";

/**
 * Keeps the invite the public directory serves for each joined community LIVE —
 * and swaps it out BEFORE it dies rather than only after.
 *
 * The BuzzRouter Agent is a member of the communities it lists, so it can probe
 * a directory invite non-consumingly (see `probeInvite`). Buzz invite tokens
 * also carry their own expiry (`parseInviteExpiry`), so we can tell not just
 * whether a code works now but whether it is about to lapse. For every joined
 * community that has a directory invite, this job probes the current code:
 *
 *   - "live" and not expiring soon → nothing to do.
 *   - "expired"/"invalid" (already dead), OR "live" but within
 *     `EXPIRY_REFRESH_WINDOW_SECONDS` of its embedded expiry → probe the
 *     harvested fresh-invite candidates in recency order and swap in a LIVE
 *     replacement (`replaceDirectoryInvite`). For an already-dead code any live
 *     candidate is an improvement; for a live-but-expiring code we only swap to
 *     a candidate that provably lasts LONGER (a later readable expiry), so we
 *     never churn a working code for an equally-soon one.
 *   - "error" → transient; skip and retry next pass.
 *
 * When a code is expiring (or dead) and NO suitable replacement is available,
 * the community is counted in `expiringNoCandidate` (or `stillStale`) — the
 * signal the admin-nudge step acts on. Every community is processed under its
 * own try/catch, and only the bare relay host (never a code) is logged.
 */

/** How far ahead of a code's embedded expiry we proactively try to replace it. */
export const EXPIRY_REFRESH_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export type ProbeInviteFn = (
  options: ProbeInviteOptions,
) => Promise<InviteHealth>;

export interface RefreshInvitesDeps {
  pool: Pool;
  /** Injectable invite probe; defaults to the real non-consuming claim probe. */
  probe?: ProbeInviteFn;
  /** Agent private key; defaults to the loaded agent identity's key. */
  privateKey?: Uint8Array;
  /** Reference time in Unix seconds; defaults to now (injectable for tests). */
  now?: number;
}

export interface RefreshInvitesResult {
  checked: number;
  live: number;
  replaced: number;
  stillStale: number;
  /** Live but expiring soon with no longer-lived replacement (nudge target). */
  expiringNoCandidate: number;
  errors: number;
}

export async function refreshStaleInvites(
  deps: RefreshInvitesDeps,
): Promise<RefreshInvitesResult> {
  const probe = deps.probe ?? defaultProbeInvite;
  const privateKey = deps.privateKey ?? loadAgentIdentity().privateKey;
  const now = deps.now ?? Math.floor(Date.now() / 1_000);

  const result: RefreshInvitesResult = {
    checked: 0,
    errors: 0,
    expiringNoCandidate: 0,
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
      if (health === "error") {
        result.errors += 1;
        continue;
      }

      const dead = health === "expired" || health === "invalid";
      const currentExpiry = parseInviteExpiry(directory.code);
      const expiringSoon =
        currentExpiry !== null &&
        currentExpiry - now <= EXPIRY_REFRESH_WINDOW_SECONDS;

      // A live code with plenty of runway left needs nothing.
      if (health === "live" && !expiringSoon) {
        result.live += 1;
        continue;
      }

      // Otherwise it is dead, or live-but-expiring — try each harvested
      // candidate until one probes LIVE and is an improvement, then swap it in
      // and consume it. For a dead code any live candidate is an improvement;
      // for a live-but-expiring code we require a provably later expiry so a
      // still-working code is never churned for an equally-soon one.
      const candidates = await listInviteCandidates(deps.pool, host);
      let swapped = false;
      for (const candidate of candidates) {
        const candidateHealth = await probe({
          code: candidate.code,
          host,
          privateKey,
        });
        if (candidateHealth !== "live") continue;

        if (!dead) {
          const candidateExpiry = parseInviteExpiry(candidate.code);
          const lastsLonger =
            candidateExpiry !== null &&
            (currentExpiry === null || candidateExpiry > currentExpiry);
          if (!lastsLonger) continue;
        }

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

      if (swapped) continue;

      if (dead) {
        result.stillStale += 1;
        console.warn(
          `${REFRESH_INVITES_QUEUE}: no live invite for ${host} (${health})`,
        );
      } else {
        // Live but expiring, and nothing fresher harvested yet: the code still
        // works today, but this is the signal to ask the admin for a new one.
        result.expiringNoCandidate += 1;
        console.warn(
          `${REFRESH_INVITES_QUEUE}: ${host} invite expiring soon, no replacement`,
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
          `stillStale=${tally.stillStale} ` +
          `expiringNoCandidate=${tally.expiringNoCandidate} ` +
          `errors=${tally.errors}`,
      );
    }
  });
}
