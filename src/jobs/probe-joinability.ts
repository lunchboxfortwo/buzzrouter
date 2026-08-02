import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  listCandidatesForJoinProbe,
  recordJoinProbe,
} from "../db/join-probes";
import {
  probeJoinability as defaultProbeJoinability,
  type JoinabilityVerdict,
} from "../directory/joinability";
import { PROBE_JOINABILITY_QUEUE } from "./queues";

/**
 * Keeps every advertised invite code's claimability verdict fresh so the
 * directory only claims "joinable" when a claim would actually land.
 *
 * For each verified community that carries a directory invite code and whose
 * verdict is missing or stale, this probes whether the code will actually admit
 * a new user (`probeJoinability`) and records the result. The probe is cheap:
 * an age-gated community is classified from a public policy read alone, so most
 * Buzz communities are settled without spending a single invite claim; only a
 * genuinely un-gated community costs one bare claim, and that only "consumes" an
 * invite use in the one case where the join would have succeeded anyway.
 *
 * DECAY: `listCandidatesForJoinProbe` re-surfaces verdicts older than
 * `STALE_AFTER_MS` (and verdicts recorded against a since-rotated code), oldest
 * first, so a policy that changes or a code that expires stops reading as
 * joinable once the next pass catches up. Only `MAX_PER_PASS` are probed per run
 * to stay well under the relay's 10 claims per 60s per-pubkey limit even as harvest
 * volume grows.
 *
 * Every community is processed under its own try/catch so one failure never
 * aborts the batch, and only the bare relay host (never a code) is logged.
 */

/** A verdict older than this is re-probed; also the directory's trust window. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** Upper bound on communities probed per pass — a rate-limit guard. */
export const MAX_PER_PASS = 50;

export type ProbeJoinabilityFn = (options: {
  host: string;
  code: string;
}) => Promise<JoinabilityVerdict>;

export interface ProbeJoinabilityDeps {
  pool: Pool;
  /** Injectable probe; defaults to the real policy-read + bare-claim classifier. */
  probe?: ProbeJoinabilityFn;
  /** Reference time; defaults to now (injectable for tests). */
  now?: Date;
  /** Batch cap; defaults to `MAX_PER_PASS`. */
  limit?: number;
}

export interface ProbeJoinabilityResult {
  checked: number;
  open: number;
  policyGated: number;
  restricted: number;
  stale: number;
  unknown: number;
  errors: number;
}

export async function probeCommunityJoinability(
  deps: ProbeJoinabilityDeps,
): Promise<ProbeJoinabilityResult> {
  const probe = deps.probe ?? defaultProbeJoinability;
  const now = deps.now ?? new Date();
  const limit = deps.limit ?? MAX_PER_PASS;

  const result: ProbeJoinabilityResult = {
    checked: 0,
    errors: 0,
    open: 0,
    policyGated: 0,
    restricted: 0,
    stale: 0,
    unknown: 0,
  };

  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const targets = await listCandidatesForJoinProbe(deps.pool, {
    limit,
    staleBefore,
  });

  for (const target of targets) {
    try {
      const verdict = await probe({ code: target.code, host: target.host });
      await recordJoinProbe(deps.pool, {
        candidateId: target.candidateId,
        code: target.code,
        detail: verdict.detail ?? null,
        status: verdict.status,
      });
      result.checked += 1;
      tally(result, verdict.status);
    } catch (error) {
      result.errors += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `${PROBE_JOINABILITY_QUEUE}: failed ${target.host}: ${reason}`,
      );
    }
  }

  return result;
}

function tally(
  result: ProbeJoinabilityResult,
  status: JoinabilityVerdict["status"],
): void {
  if (status === "open") result.open += 1;
  else if (status === "policy_gated") result.policyGated += 1;
  else if (status === "restricted") result.restricted += 1;
  else if (status === "stale") result.stale += 1;
  else result.unknown += 1;
}

/**
 * Registers the pg-boss worker that drains the joinability-probe schedule.
 * Mirrors `registerRefreshInvitesWorker`: a single-batch worker that runs one
 * probe pass per fired job.
 */
export async function registerProbeJoinabilityWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(PROBE_JOINABILITY_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const _job of jobs) {
      const tallyResult = await probeCommunityJoinability({ pool });
      console.log(
        `${PROBE_JOINABILITY_QUEUE}: checked=${tallyResult.checked} ` +
          `open=${tallyResult.open} policyGated=${tallyResult.policyGated} ` +
          `restricted=${tallyResult.restricted} stale=${tallyResult.stale} ` +
          `unknown=${tallyResult.unknown} errors=${tallyResult.errors}`,
      );
    }
  });
}
