import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  dedicatedChannelName,
  provisionPeerChannels,
} from "./provision-peer-channels";

const HOME = {
  community_id: "11111111-1111-4111-8111-111111111111",
  owner_pubkey: "a".repeat(64),
  shared_channel_id: "22222222-2222-4222-8222-222222222222",
};

/**
 * A pg Pool answering the three queries a pass makes, recording every endpoint
 * insert. `home: false` models the hub not existing yet.
 */
function makePool(peers: string[], home = true): {
  pool: Pool;
  inserted: unknown[][];
} {
  const inserted: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO shared_channel_endpoints/i.test(sql)) {
      inserted.push(params);
      return { rows: [{ id: "endpoint" }] };
    }
    if (/FROM shared_channel_endpoints AS peer/i.test(sql)) {
      return { rows: peers.map((community_id) => ({ community_id })) };
    }
    return { rows: home ? [HOME] : [] };
  });
  return { pool: { query } as unknown as Pool, inserted };
}

describe("provisionPeerChannels", () => {
  it("does nothing until BuzzRouter itself is on the hub", async () => {
    const { pool, inserted } = makePool(["peer"], false);
    const createChannel = vi.fn();

    expect(await provisionPeerChannels({ createChannel, pool })).toEqual({
      errors: 0,
      provisioned: 0,
    });
    expect(createChannel).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("names each channel after the peer and keys the handoff by peer", async () => {
    const peer = "33333333-3333-4333-8333-333333333333";
    const { pool } = makePool([peer]);
    const createChannel = vi.fn(async () => ({
      channelId: "channel-relay-id",
      channelName: dedicatedChannelName(peer),
    }));

    await provisionPeerChannels({ createChannel, pool });

    expect(createChannel).toHaveBeenCalledWith({
      channelName: `channel-${peer}`,
      communityId: HOME.community_id,
      idempotencyKey: `hub-dedicated:${peer}`,
      ownerPubkey: HOME.owner_pubkey,
    });
  });

  // One unreachable relay must not stop the peers behind it in the batch from
  // getting their channel, and the failed one is simply retried next pass.
  it("keeps going when one peer's channel cannot be created", async () => {
    const failing = "44444444-4444-4444-8444-444444444444";
    const working = "55555555-5555-4555-8555-555555555555";
    const { pool, inserted } = makePool([failing, working]);
    const createChannel = vi.fn(async (input: { channelName: string }) => {
      if (input.channelName.includes(failing)) {
        throw new Error("relay unreachable");
      }
      return { channelId: "working-relay-id", channelName: input.channelName };
    });

    expect(await provisionPeerChannels({ createChannel, pool })).toEqual({
      errors: 1,
      provisioned: 1,
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain(working);
  });
});
