import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  upsertCandidate as defaultUpsertCandidate,
  type CandidateRecord,
  type CandidateSource,
} from "../db/candidates";
import { listJoinedCommunities, recordInviteCandidate } from "../db/presence";
import { normalizeRelayUrl, type NormalizedRelay } from "../discovery/normalize";
import {
  extractInvites,
  type HarvestedInvite,
} from "../presence/extract-invites";
import { llmExtractInvites } from "../presence/llm-extract-invites";
import {
  readCommunityContent as defaultReadCommunityContent,
  type CommunityContent,
  type ReadCommunityOptions,
} from "../presence/reader";
import { HARVEST_INVITES_QUEUE } from "./queues";

/**
 * Harvests community invite links out of the channels the BuzzRouter Agent can
 * already read, and turns them into coverage.
 *
 * The agent is a read-only member of many Buzz communities; people paste invite
 * links (`buzz://join?...`, `https://host/invite/<code>`) into channels — and
 * pin them in channel descriptions. This job reads recent messages AND each
 * channel's metadata (`about`/`name`) from every joined community, extracts
 * those invites, and classifies each one against the communities we're in:
 *
 *   - NOT already joined  → INGEST it as a directory candidate (source type
 *     `"harvest"`, carrying the invite code) rather than joining directly, so
 *     the existing discovery/probe/verification pipeline vets it before it is
 *     ever joined or displayed. Once verified it becomes joinable and the
 *     auto-join job picks it up. This closes the injection/orphaned-summary gap.
 *   - ALREADY joined       → record the code as a fresh-invite CANDIDATE. The
 *     actual stale-invite replacement/swap is intentionally NOT done here — it
 *     runs in the separate `refreshStaleInvites` job. We only collect candidates.
 *
 * Every invite is processed under its own try/catch so one failure never aborts
 * the batch, and only the bare relay host (never a key, receipt, or invite code)
 * is logged.
 */

export type ReadContentFn = (
  options: ReadCommunityOptions,
) => Promise<CommunityContent>;

export type LlmExtractFn = (
  messages: { content: string }[],
) => Promise<HarvestedInvite[]>;

export type InjectCandidateFn = (
  pool: Pool,
  relay: NormalizedRelay,
  source: CandidateSource,
) => Promise<CandidateRecord>;

export interface HarvestInvitesDeps {
  pool: Pool;
  /**
   * Injectable community reader; defaults to the real NIP-42 relay read that
   * returns both the channel index and recent messages.
   */
  readContent?: ReadContentFn;
  /** Injectable candidate ingestion; defaults to the real `upsertCandidate`. */
  injectImpl?: InjectCandidateFn;
  /**
   * Injectable LLM recall pass; defaults to the real `llmExtractInvites`. Runs
   * as a second pass alongside the regex extractor to surface invites the
   * structured formats miss. Recall-only: every candidate it returns is still
   * re-validated by `extractInvites` and vetted downstream.
   */
  llmExtractImpl?: LlmExtractFn;
  /** Agent private key; defaults to the loaded agent identity's key. */
  privateKey?: Uint8Array;
  /** Recent-message read cap per community. Defaults to the reader's own. */
  messageLimit?: number;
}

export interface HarvestInvitesResult {
  scannedCommunities: number;
  invitesFound: number;
  newCommunitiesIngested: number;
  candidatesForExisting: number;
  failed: number;
}

interface Harvested {
  relayHost: string;
  relayUrl: string;
  code: string;
  /** Relay host of the community whose channel the invite was seen in. */
  sourceRelayHost: string;
}

/**
 * Reads every joined community, extracts invites from each message, and returns
 * the joined-host set plus a `(relayHost, code)`-deduplicated list of harvested
 * invites (first source wins). Reader failures are isolated per community.
 */
async function collectInvites(
  deps: HarvestInvitesDeps,
  readContent: ReadContentFn,
  llmExtract: LlmExtractFn,
  result: HarvestInvitesResult,
): Promise<{ joinedHosts: Set<string>; harvested: Harvested[] }> {
  const joined = await listJoinedCommunities(deps.pool);
  const joinedHosts = new Set(joined.map((c) => c.relayHost.toLowerCase()));

  const harvested: Harvested[] = [];
  const seen = new Set<string>();

  const push = (invite: HarvestedInvite, sourceRelayHost: string): void => {
    const key = `${invite.relayHost} ${invite.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    harvested.push({ ...invite, sourceRelayHost });
  };

  for (const community of joined) {
    result.scannedCommunities += 1;
    let content: CommunityContent;
    try {
      content = await readContent({
        limit: deps.messageLimit,
        relayUrl: community.relayUrl,
      });
    } catch (error) {
      result.failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `${HARVEST_INVITES_QUEUE}: read failed ${community.relayHost}: ${reason}`,
      );
      continue;
    }

    // Scan chat AND channel metadata: invites get pinned in a channel's
    // `about`/`name` as often as they're pasted into chat. Both are free-form
    // text carrying the same two structured link shapes.
    const texts: string[] = content.messages.map((message) => message.content);
    for (const channel of content.channels) {
      if (channel.about) texts.push(channel.about);
      if (channel.name) texts.push(channel.name);
    }

    // First pass: the deterministic structured-format extractor over every text.
    for (const text of texts) {
      for (const invite of extractInvites(text)) {
        push(invite, community.relayHost);
      }
    }

    // Second pass: LLM recall for invites the regex missed, over the same texts.
    // Every candidate is already re-validated by `extractInvites` inside
    // `llmExtract`, so these merge (and dedupe) on equal footing with the regex
    // hits. Isolated so a recall failure never aborts the scan.
    try {
      for (const invite of await llmExtract(texts.map((content) => ({ content })))) {
        push(invite, community.relayHost);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `${HARVEST_INVITES_QUEUE}: recall failed ${community.relayHost}: ${reason}`,
      );
    }
  }

  result.invitesFound = harvested.length;
  return { harvested, joinedHosts };
}

export async function harvestInvites(
  deps: HarvestInvitesDeps,
): Promise<HarvestInvitesResult> {
  const readContent = deps.readContent ?? defaultReadCommunityContent;
  const injectImpl = deps.injectImpl ?? defaultUpsertCandidate;
  const llmExtract = deps.llmExtractImpl ?? llmExtractInvites;

  const result: HarvestInvitesResult = {
    candidatesForExisting: 0,
    failed: 0,
    invitesFound: 0,
    newCommunitiesIngested: 0,
    scannedCommunities: 0,
  };

  const { harvested, joinedHosts } = await collectInvites(
    deps,
    readContent,
    llmExtract,
    result,
  );

  for (const invite of harvested) {
    try {
      if (joinedHosts.has(invite.relayHost)) {
        // Already a member — collect the fresh code as a candidate only. The
        // live-invite swap runs in `refreshStaleInvites`; do NOT swap here.
        await recordInviteCandidate(deps.pool, {
          code: invite.code,
          relayHost: invite.relayHost,
          sourceRelayHost: invite.sourceRelayHost,
        });
        result.candidatesForExisting += 1;
        continue;
      }

      // A community we're not in yet — INGEST it as a directory candidate,
      // carrying the invite code, so discovery/probing/verification vets it
      // before it is ever joined or displayed. It is deliberately NOT joined
      // here; once verified the auto-join job claims it.
      await injectImpl(deps.pool, normalizeRelayUrl(invite.relayUrl), {
        evidenceId: invite.relayHost,
        listing: { inviteCode: invite.code },
        type: "harvest",
      });
      result.newCommunitiesIngested += 1;
      console.log(`${HARVEST_INVITES_QUEUE}: ingested ${invite.relayHost}`);
    } catch (error) {
      result.failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `${HARVEST_INVITES_QUEUE}: failed ${invite.relayHost}: ${reason}`,
      );
    }
  }

  return result;
}

/**
 * Registers the pg-boss worker that drains the invite-harvest schedule. Mirrors
 * `registerAutoJoinWorker`: a single-batch worker that runs one harvest pass per
 * fired job. Harvested new communities are ingested as directory candidates
 * (not joined), so there is no summary to refresh here — the discovery pipeline
 * verifies them and the auto-join job claims them once they are joinable.
 */
export async function registerHarvestInvitesWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(HARVEST_INVITES_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const _job of jobs) {
      const tally = await harvestInvites({ pool });
      console.log(
        `${HARVEST_INVITES_QUEUE}: scanned=${tally.scannedCommunities} ` +
          `found=${tally.invitesFound} ingested=${tally.newCommunitiesIngested} ` +
          `candidates=${tally.candidatesForExisting} failed=${tally.failed}`,
      );
    }
  });
}
