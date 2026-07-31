import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  listJoinedCommunities,
  recordInviteCandidate,
  upsertMembership,
} from "../db/presence";
import { extractInvites } from "../presence/extract-invites";
import { loadAgentIdentity } from "../presence/identity";
import {
  joinCommunity as defaultJoinCommunity,
  type JoinCommunityOptions,
  type JoinCommunityResult,
} from "../presence/policy";
import {
  readCommunity as defaultReadCommunity,
  type PresenceMessage,
  type ReadCommunityOptions,
} from "../presence/reader";
import { HARVEST_INVITES_QUEUE, REFRESH_SUMMARIES_QUEUE } from "./queues";

/**
 * Harvests community invite links out of the channels the BuzzRouter Agent can
 * already read, and turns them into coverage.
 *
 * The agent is a read-only member of many Buzz communities; people paste invite
 * links (`buzz://join?...`, `https://host/invite/<code>`) into channels. This
 * job reads recent messages from every joined community, extracts those invites,
 * and classifies each one against the set of communities we're already in:
 *
 *   - NOT already joined  → claim the invite (explicitly accepting Block's Terms
 *     of Service + the 18+ age attestation, `acceptTerms: true`, which is
 *     authorized/counsel-approved) and record the new membership. COVERAGE.
 *   - ALREADY joined       → record the code as a fresh-invite CANDIDATE. The
 *     actual stale-invite replacement/swap is intentionally NOT done here — it
 *     is gated on a separate health-check spike. We only collect candidates.
 *
 * Every invite is processed under its own try/catch so one failure never aborts
 * the batch, and only the bare relay host (never a key, receipt, or invite code)
 * is logged.
 */

export type ReadCommunityFn = (
  options: ReadCommunityOptions,
) => Promise<PresenceMessage[]>;

export type JoinCommunityFn = (
  options: JoinCommunityOptions,
) => Promise<JoinCommunityResult>;

export interface HarvestInvitesDeps {
  pool: Pool;
  /** Injectable community reader; defaults to the real NIP-42 relay read. */
  readCommunity?: ReadCommunityFn;
  /** Injectable join implementation; defaults to the real policy handshake. */
  joinImpl?: JoinCommunityFn;
  /** Agent private key; defaults to the loaded agent identity's key. */
  privateKey?: Uint8Array;
  /** Recent-message read cap per community. Defaults to the reader's own. */
  messageLimit?: number;
}

export interface HarvestInvitesResult {
  scannedCommunities: number;
  invitesFound: number;
  newCommunitiesJoined: number;
  candidatesForExisting: number;
  failed: number;
}

function communityIdFromBody(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null) {
    const value = (body as Record<string, unknown>).community_id;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
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
  const joinImpl = deps.joinImpl ?? defaultJoinCommunity;
  const privateKey = deps.privateKey ?? loadAgentIdentity().privateKey;

  const result: HarvestInvitesResult = {
    candidatesForExisting: 0,
    failed: 0,
    invitesFound: 0,
    newCommunitiesJoined: 0,
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
        // live-invite swap is gated on the health-check spike; do NOT swap here.
        await recordInviteCandidate(deps.pool, {
          code: invite.code,
          relayHost: invite.relayHost,
          sourceRelayHost: invite.sourceRelayHost,
        });
        result.candidatesForExisting += 1;
        continue;
      }

      // A community we're not in yet — claim the invite for coverage.
      const outcome = await joinImpl({
        acceptTerms: true,
        code: invite.code,
        host: invite.relayHost,
        privateKey,
      });

      if (outcome.ok) {
        await upsertMembership(deps.pool, {
          communityId: communityIdFromBody(outcome.body),
          relayHost: invite.relayHost,
          relayUrl: invite.relayUrl,
        });
        // Track it as joined so a second invite for the same host this pass is
        // treated as a candidate rather than re-claimed.
        joinedHosts.add(invite.relayHost);
        result.newCommunitiesJoined += 1;
        console.log(`${HARVEST_INVITES_QUEUE}: joined ${invite.relayHost}`);
        continue;
      }

      result.failed += 1;
      console.error(
        `${HARVEST_INVITES_QUEUE}: join failed ${invite.relayHost}: ${outcome.reason}`,
      );
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
 * fired job, and — when it joined at least one new community — enqueues a summary
 * refresh so the freshly joined communities get summarized right away instead of
 * waiting for the next tick.
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
          `found=${tally.invitesFound} joined=${tally.newCommunitiesJoined} ` +
          `candidates=${tally.candidatesForExisting} failed=${tally.failed}`,
      );
      if (tally.newCommunitiesJoined > 0) {
        await boss.send(REFRESH_SUMMARIES_QUEUE, null);
      }
    }
  });
}
