import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  upsertCandidate as defaultUpsertCandidate,
  type CandidateRecord,
  type CandidateSource,
} from "../db/candidates";
import { listJoinedCommunities, recordInviteCandidate } from "../db/presence";
import {
  getSourceCursor,
  recordSourceFailure,
  recordSourceSuccess,
  type SourceCursor,
} from "../db/source-state";
import { normalizeRelayUrl, type NormalizedRelay } from "../discovery/normalize";
import { extractInvites } from "../presence/extract-invites";
import { isSourceEnabled } from "../sources/config";
import { SourceAdapterError } from "../sources/errors";
import {
  createXSearchClient,
  DEFAULT_X_INVITE_QUERY,
  postTextForExtraction,
  type XRecentSearchClient,
  type XSearchPost,
} from "../sources/x-search";
import { SOURCE_X_QUEUE } from "./queues";

/**
 * Harvests Buzz community invite links from public X posts via recent search.
 *
 * Same outcome split as in-community `harvestInvites`:
 *
 *   - ALREADY joined  → `harvested_invite_candidates` (spare codes; refresh job
 *     swaps them in when the live directory invite is dead/expiring).
 *   - NOT joined      → directory candidate with `source_type = "x"` and the
 *     invite code, for probe/verify/auto-join.
 *
 * Cursor is the X `since_id` (newest post id seen). Pages within a run use
 * `next_token` so a first catch-up can walk several pages without re-billing
 * the same posts on the next tick.
 */

export const SOURCE_KEY = "x";

const MAX_PAGES_PER_RUN = 3;
const MAX_RESULTS_PER_PAGE = 100;

export interface XInviteCursor extends SourceCursor {
  sinceId: string | null;
  version: 1;
}

export type InjectCandidateFn = (
  pool: Pool,
  relay: NormalizedRelay,
  source: CandidateSource,
) => Promise<CandidateRecord>;

export interface HarvestXInvitesDeps {
  pool: Pool;
  /** Injectable X client; defaults to Bearer-auth client from env. */
  client?: XRecentSearchClient;
  /** Injectable candidate ingestion; defaults to real `upsertCandidate`. */
  injectImpl?: InjectCandidateFn;
  /** Search query; defaults to invite-focused DEFAULT_X_INVITE_QUERY. */
  query?: string;
  /** Cap pages read per tick (default 3). */
  maxPages?: number;
}

export interface HarvestXInvitesResult {
  pagesRead: number;
  postsRead: number;
  invitesFound: number;
  newCommunitiesIngested: number;
  candidatesForExisting: number;
  failed: number;
}

/**
 * One discovery tick: search X, extract invites, record spares / ingest new
 * hosts, advance the since_id cursor.
 */
export async function harvestXInvites(
  deps: HarvestXInvitesDeps,
): Promise<HarvestXInvitesResult> {
  const injectImpl = deps.injectImpl ?? defaultUpsertCandidate;
  const client = deps.client ?? defaultClientFromEnv();
  const query = deps.query ?? DEFAULT_X_INVITE_QUERY;
  const maxPages = deps.maxPages ?? MAX_PAGES_PER_RUN;

  const cursor = sanitizeCursor(
    await getSourceCursor<XInviteCursor>(deps.pool, SOURCE_KEY, {
      sinceId: null,
      version: 1,
    }),
  );

  const result: HarvestXInvitesResult = {
    candidatesForExisting: 0,
    failed: 0,
    invitesFound: 0,
    newCommunitiesIngested: 0,
    pagesRead: 0,
    postsRead: 0,
  };

  const joined = await listJoinedCommunities(deps.pool);
  const joinedHosts = new Set(joined.map((c) => c.relayHost.toLowerCase()));

  // Dedup (host, code) across pages in this tick.
  const seenInvites = new Set<string>();
  let sinceId = cursor.sinceId;
  let newestSeen: string | null = sinceId;
  let nextToken: string | null = null;

  try {
    do {
      const page = await client.searchRecent({
        maxResults: MAX_RESULTS_PER_PAGE,
        nextToken,
        query,
        sinceId: nextToken ? null : sinceId,
      });
      result.pagesRead += 1;
      result.postsRead += page.posts.length;

      if (
        page.newestId &&
        (!newestSeen || compareSnowflakeId(page.newestId, newestSeen) > 0)
      ) {
        newestSeen = page.newestId;
      }

      for (const post of page.posts) {
        await processPost(post, {
          injectImpl,
          joinedHosts,
          pool: deps.pool,
          result,
          seenInvites,
        });
      }

      nextToken =
        result.pagesRead < maxPages && page.nextToken ? page.nextToken : null;
    } while (nextToken);

    await recordSourceSuccess(
      deps.pool,
      SOURCE_KEY,
      { sinceId: newestSeen, version: 1 } satisfies XInviteCursor,
      {
        candidatesAccepted: result.newCommunitiesIngested,
        candidatesIgnored: result.candidatesForExisting,
        eventsRead: result.postsRead,
        pagesRead: result.pagesRead,
      },
    );
  } catch (error) {
    const code =
      error instanceof SourceAdapterError ? error.code : "remote_failed";
    await recordSourceFailure(deps.pool, SOURCE_KEY, code);
    throw error;
  }

  return result;
}

async function processPost(
  post: XSearchPost,
  ctx: {
    pool: Pool;
    joinedHosts: Set<string>;
    injectImpl: InjectCandidateFn;
    seenInvites: Set<string>;
    result: HarvestXInvitesResult;
  },
): Promise<void> {
  const text = postTextForExtraction(post);
  const invites = extractInvites(text);
  if (invites.length === 0) {
    return;
  }

  const locator = `https://x.com/i/status/${post.id}`;

  for (const invite of invites) {
    const key = `${invite.relayHost} ${invite.code}`;
    if (ctx.seenInvites.has(key)) {
      continue;
    }
    ctx.seenInvites.add(key);
    ctx.result.invitesFound += 1;

    try {
      if (ctx.joinedHosts.has(invite.relayHost)) {
        // Spare queue for later refresh swap — do not clobber the live code.
        await recordInviteCandidate(ctx.pool, {
          code: invite.code,
          relayHost: invite.relayHost,
          sourceRelayHost: null,
        });
        ctx.result.candidatesForExisting += 1;
        continue;
      }

      await ctx.injectImpl(ctx.pool, normalizeRelayUrl(invite.relayUrl), {
        evidenceId: post.id,
        listing: { inviteCode: invite.code },
        locator,
        observedAt: post.createdAt ? new Date(post.createdAt) : undefined,
        type: "x",
      });
      ctx.result.newCommunitiesIngested += 1;
      console.log(`${SOURCE_X_QUEUE}: ingested ${invite.relayHost}`);
    } catch (error) {
      ctx.result.failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `${SOURCE_X_QUEUE}: failed ${invite.relayHost}: ${reason}`,
      );
    }
  }
}

/**
 * Registers the pg-boss worker. Gated by DISCOVERY_X_ENABLED=true so a missing
 * token does not fail the worker process on every schedule tick.
 */
export async function registerHarvestXInvitesWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(SOURCE_X_QUEUE, { batchSize: 1 }, async (jobs) => {
    if (!isSourceEnabled("DISCOVERY_X_ENABLED")) {
      return;
    }

    for (const _job of jobs) {
      try {
        const tally = await harvestXInvites({ pool });
        console.log(
          `${SOURCE_X_QUEUE}: pages=${tally.pagesRead} posts=${tally.postsRead} ` +
            `found=${tally.invitesFound} ingested=${tally.newCommunitiesIngested} ` +
            `spares=${tally.candidatesForExisting} failed=${tally.failed}`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`${SOURCE_X_QUEUE}: run failed: ${reason}`);
        throw error;
      }
    }
  });
}

function defaultClientFromEnv(): XRecentSearchClient {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    throw new SourceAdapterError(
      "invalid_configuration",
      "X_BEARER_TOKEN is required when X invite discovery is enabled.",
    );
  }
  return createXSearchClient(token);
}

function sanitizeCursor(cursor: XInviteCursor): XInviteCursor {
  if (
    cursor &&
    cursor.version === 1 &&
    (cursor.sinceId === null || typeof cursor.sinceId === "string")
  ) {
    return { sinceId: cursor.sinceId, version: 1 };
  }
  return { sinceId: null, version: 1 };
}

/**
 * Compare two X snowflake ids as big-endian decimal strings. Returns >0 if a
 * is newer than b. Falls back to string compare when either is non-numeric.
 */
export function compareSnowflakeId(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    if (a.length !== b.length) {
      return a.length - b.length;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
