import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  upsertCandidate as defaultUpsertCandidate,
  type CandidateRecord,
  type CandidateSource,
} from "../db/candidates";
import { listJoinedCommunities, recordInviteCandidate } from "../db/presence";
import { normalizeRelayUrl, type NormalizedRelay } from "../discovery/normalize";
import { extractInvites } from "../presence/extract-invites";
import {
  readCommunity as defaultReadCommunity,
  type PresenceMessage,
  type ReadCommunityOptions,
} from "../presence/reader";
import { HARVEST_INVITES_QUEUE } from "./queues";

/**
 * Harvests community invite links out of the channels the BuzzRouter Agent can
 * already read, and turns them into coverage.
 *
 * The agent is a read-only member of many Buzz communities; people paste invite
 * links (`buzz://join?...`, `https://host/invite/<code>`) into channels. This
 * job reads recent messages from every joined community, extracts those invites,
 * and classifies each one against the set of communities we're already in:
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

export type ReadCommunityFn = (
  options: ReadCommunityOptions,
) => Promise<PresenceMessage[]>;

export type InjectCandidateFn = (
  pool: Pool,
  relay: NormalizedRelay,
  source: CandidateSource,
) => Promise<CandidateRecord>;

export interface HarvestInvitesDeps {
  pool: Pool;
  /** Injectable community reader; defaults to the real NIP-42 relay read. */
  readCommunity?: ReadCommunityFn;
  /** Injectable candidate ingestion; defaults to the real `upsertCandidate`. */
  injectImpl?: InjectCandidateFn;
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
  readCommunity: ReadCommunityFn,
  result: HarvestInvitesResult,
): Promise<{ joinedHosts: Set<string>; harvested: Harvested[] }> {
  const joined = await listJoinedCommunities(deps.pool);
  const joinedHosts = new Set(joined.map((c) => c.relayHost.toLowerCase()));

  const harvested: Harvested[] = [];
  const seen = new Set<string>();

  for (const community of joined) {
    result.scannedCommunities += 1;
    let messages: PresenceMessage[];
    try {
      messages = await readCommunity({
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

    for (const message of messages) {
      for (const invite of extractInvites(message.content)) {
        const key = `${invite.relayHost} ${invite.code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        harvested.push({ ...invite, sourceRelayHost: community.relayHost });
      }
    }
  }

  result.invitesFound = harvested.length;
  return { harvested, joinedHosts };
}

export async function harvestInvites(
  deps: HarvestInvitesDeps,
): Promise<HarvestInvitesResult> {
  const readCommunity = deps.readCommunity ?? defaultReadCommunity;
  const injectImpl = deps.injectImpl ?? defaultUpsertCandidate;

  const result: HarvestInvitesResult = {
    candidatesForExisting: 0,
    failed: 0,
    invitesFound: 0,
    newCommunitiesIngested: 0,
    scannedCommunities: 0,
  };

  const { harvested, joinedHosts } = await collectInvites(
    deps,
    readCommunity,
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
