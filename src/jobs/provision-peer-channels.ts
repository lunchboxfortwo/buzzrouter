import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  createDedicatedChannel,
  type CreateDedicatedChannelInput,
  type DedicatedChannel,
} from "../shared-channels/channel-handoff";
import {
  createFileWrappingKeyProvider,
  createRelayConnectionFactory,
  type RelayConnectionFactory,
  type WrappingKeyProvider,
} from "../shared-channels/connector";
import {
  attachDedicatedPeerChannel,
  getHubHomeEndpoint,
  listHubPeersMissingDedicatedChannel,
  getCommunitySlug,
} from "../shared-channels/store";
import { PROVISION_PEER_CHANNELS_QUEUE } from "./queues";

/**
 * Give every hub participant its own channel on the relay BuzzRouter operates,
 * instead of taking all of them into the one shared `general` channel.
 *
 * This is the only place the dedicated endpoints are created, for both new and
 * already-connected communities: `listHubPeersMissingDedicatedChannel` asks
 * "who lacks one", which an existing participant answers exactly as a brand new
 * one does. Nothing is enqueued at join time, because nothing in the connect
 * flow waits on it — until the channel exists the peer's messages keep landing
 * in `general`, which stays the fallback.
 *
 * Channel creation goes through the journaled create -> promote a real
 * owner/admin -> demote the bridge handoff, keyed by peer so a failed pass
 * resumes where it stopped and never leaves the bridge owning a channel. The
 * endpoint row is written only after that handoff completes.
 */

/** Upper bound on channels created per pass; a relay round-trip guard. */
export const MAX_PER_PASS = 10;

export type CreateDedicatedChannelFn = (
  input: CreateDedicatedChannelInput,
) => Promise<DedicatedChannel>;

export interface ProvisionPeerChannelsDeps {
  pool: Pool;
  /** Batch cap; defaults to `MAX_PER_PASS`. */
  limit?: number;
  relayFactory?: RelayConnectionFactory;
  wrappingKeys?: WrappingKeyProvider;
  /** Injectable channel creation; defaults to the real journaled handoff. */
  createChannel?: CreateDedicatedChannelFn;
}

export interface ProvisionPeerChannelsResult {
  errors: number;
  provisioned: number;
}

/**
 * The channel name a peer's dedicated BuzzRouter channel is created with.
 *
 * Named for the peer's addressable handle, not its UUID: this string is what a
 * human reads in the Buzz client, and `channel-15ffe2aa-e1bd-4f24-...` tells
 * them nothing. Renaming after creation is not an option — kind 9002 requires
 * channel-owner authority, and the handoff deliberately leaves a real human as
 * owner, so the name has to be right at creation.
 *
 * Falls back to the id when a peer somehow has no slug, because a channel with
 * an ugly name beats no channel at all.
 */
export function dedicatedChannelName(
  peerCommunityId: string,
  peerSlug?: string | null,
): string {
  const slug = peerSlug?.trim();
  return slug ? `connect-${slug}` : `channel-${peerCommunityId}`;
}

export async function provisionPeerChannels(
  deps: ProvisionPeerChannelsDeps,
): Promise<ProvisionPeerChannelsResult> {
  const result: ProvisionPeerChannelsResult = { errors: 0, provisioned: 0 };
  const home = await getHubHomeEndpoint(deps.pool);
  if (!home) return result;

  const createChannel =
    deps.createChannel ??
    ((input) =>
      createDedicatedChannel(
        deps.pool,
        input,
        deps.wrappingKeys ?? createFileWrappingKeyProvider(),
        deps.relayFactory ?? createRelayConnectionFactory(),
      ));

  const peers = await listHubPeersMissingDedicatedChannel(
    deps.pool,
    home,
    deps.limit ?? MAX_PER_PASS,
  );

  for (const peerCommunityId of peers) {
    try {
      const channel = await createChannel({
        channelName: dedicatedChannelName(
          peerCommunityId,
          await getCommunitySlug(deps.pool, peerCommunityId),
        ),
        communityId: home.communityId,
        // Resumable and stable per peer: a retry reuses the same channel
        // rather than creating a second one on our relay.
        idempotencyKey: `hub-dedicated:${peerCommunityId}`,
        ownerPubkey: home.ownerPubkey,
      });
      if (
        await attachDedicatedPeerChannel(deps.pool, {
          home,
          localChannelId: channel.channelId,
          localChannelName: channel.channelName,
          peerCommunityId,
        })
      ) {
        result.provisioned += 1;
      }
    } catch (error) {
      result.errors += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `${PROVISION_PEER_CHANNELS_QUEUE}: failed ${peerCommunityId}: ${reason}`,
      );
    }
  }

  return result;
}

/**
 * Registers the pg-boss worker that drains the peer-channel schedule. Mirrors
 * `registerProbeJoinabilityWorker`: a single-batch worker that runs one
 * provisioning pass per fired job.
 */
export async function registerProvisionPeerChannelsWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(
    PROVISION_PEER_CHANNELS_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const _job of jobs) {
        const pass = await provisionPeerChannels({ pool });
        if (pass.provisioned > 0 || pass.errors > 0) {
          console.log(
            `${PROVISION_PEER_CHANNELS_QUEUE}: provisioned=${pass.provisioned} ` +
              `errors=${pass.errors}`,
          );
        }
      }
    },
  );
}
