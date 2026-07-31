import { describe, expect, it, vi } from "vitest";

import type { Pool } from "pg";

import { listCommunityLocalChannels } from "./local-channels";

const INPUT = {
  communityId: "00000000-0000-4000-8000-000000000000",
  ownerPubkey: "a".repeat(64),
};

function fakePool(rows: unknown[]): Pool {
  return { query: vi.fn(async () => ({ rows })) } as unknown as Pool;
}

describe("listCommunityLocalChannels", () => {
  it("reports the connector inactive without decrypting a key or opening a relay", async () => {
    const pool = fakePool([
      {
        community_id: INPUT.communityId,
        connection_id: null,
        encrypted_private_key: null,
        private_key_auth_tag: null,
        private_key_nonce: null,
      },
    ]);
    const getKey = vi.fn();
    const connect = vi.fn();

    await expect(
      listCommunityLocalChannels(pool, INPUT, { getKey }, { connect }),
    ).resolves.toEqual({ channels: [], connectorActive: false });
    expect(getKey).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("requires verified community ownership", async () => {
    const pool = fakePool([]);
    const connect = vi.fn();

    await expect(
      listCommunityLocalChannels(
        pool,
        INPUT,
        { getKey: vi.fn() },
        { connect },
      ),
    ).rejects.toMatchObject({
      code: "community_owner_required",
      status: 403,
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
