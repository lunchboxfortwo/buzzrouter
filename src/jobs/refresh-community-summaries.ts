import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  listJoinedCommunities,
  upsertSummary,
} from "../db/presence";
import {
  readCommunity as defaultReadCommunity,
  type PresenceMessage,
} from "../presence/reader";
import {
  buildCommunitySummary as defaultBuildSummary,
  type CommunitySummary,
} from "../presence/summarize";
import { REFRESH_SUMMARIES_QUEUE } from "./queues";

/**
 * Recurring 4-hour refresh of every joined community's cached directory summary.
 * For each membership row the BuzzRouter Agent reads recent public activity from
 * the relay, rebuilds the `{ goals, recentProjects, ... }` summary, and upserts
 * it. The reader loads the agent key from `BUZZ_AGENT_KEY`/the identity file and
 * the summarizer reads `OPENROUTER_API_KEY` + `OPENROUTER_BASE_URL` from the
 * environment — nothing here hardcodes a key, token, or URL.
 *
 * Each community is processed under its own try/catch so a single unreachable
 * relay or summarization error never aborts the batch, and only the relay host
 * (never a key or message content) is logged.
 */

export type ReadCommunityFn = (options: {
  relayUrl: string;
}) => Promise<PresenceMessage[]>;

export type BuildSummaryFn = (
  messages: PresenceMessage[],
) => Promise<CommunitySummary>;

export interface RefreshDeps {
  pool: Pool;
  /** Injectable relay reader; defaults to the real NIP-42 reader. */
  readCommunity?: ReadCommunityFn;
  /** Injectable summarizer; defaults to the deterministic + LLM pipeline. */
  buildSummary?: BuildSummaryFn;
}

export interface RefreshResult {
  ok: number;
  failed: number;
}

export async function refreshCommunitySummaries(
  deps: RefreshDeps,
): Promise<RefreshResult> {
  const readCommunity = deps.readCommunity ?? defaultReadCommunity;
  const buildSummary = deps.buildSummary ?? defaultBuildSummary;

  const communities = await listJoinedCommunities(deps.pool);
  let ok = 0;
  let failed = 0;

  for (const community of communities) {
    try {
      const messages = await readCommunity({ relayUrl: community.relayUrl });
      const summary = await buildSummary(messages);
      await upsertSummary(deps.pool, community.relayHost, summary);
      ok += 1;
      console.log(
        `presence.refresh-summaries: refreshed ${community.relayHost} ` +
          `(${summary.messageCount} msgs, ${summary.activityLevel})`,
      );
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `presence.refresh-summaries: failed ${community.relayHost}: ${reason}`,
      );
    }
  }

  return { failed, ok };
}

/**
 * Registers the pg-boss worker that drains the recurring refresh schedule.
 * Mirrors `registerDueProbeScheduler`: a single-batch worker that runs the
 * refresh pass once per fired job.
 */
export async function registerRefreshSummariesWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(
    REFRESH_SUMMARIES_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const _job of jobs) {
        await refreshCommunitySummaries({ pool });
      }
    },
  );
}
