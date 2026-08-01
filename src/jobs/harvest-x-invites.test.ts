import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CandidateRecord } from "../db/candidates";
import type { XRecentSearchClient, XSearchPage } from "../sources/x-search";
import {
  compareSnowflakeId,
  harvestXInvites,
  registerHarvestXInvitesWorker,
  type InjectCandidateFn,
} from "./harvest-x-invites";
import { SOURCE_X_QUEUE } from "./queues";

function candidateRecord(host: string): CandidateRecord {
  return {
    canonicalRelayUrl: `wss://${host}`,
    id: `cand-${host}`,
    state: "discovered",
  };
}

/**
 * Pool stub: SELECT for joined communities, SELECT for source cursor, and
 * INSERT/UPDATE paths that no-op. Records every SQL call.
 */
function poolWith(options: {
  joined?: { relay_host: string; relay_url: string; community_id: string | null }[];
  cursor?: unknown;
}): { pool: Pool; query: ReturnType<typeof vi.fn> } {
  const joined = options.joined ?? [];
  const cursor = options.cursor ?? null;
  const query = vi.fn(async (sql: string) => {
    if (/FROM presence_communities/i.test(sql)) {
      return { rows: joined };
    }
    if (/FROM discovery_source_state/i.test(sql)) {
      return { rows: cursor ? [{ cursor }] : [] };
    }
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, query };
}

function page(overrides: Partial<XSearchPage> = {}): XSearchPage {
  return {
    newestId: null,
    nextToken: null,
    oldestId: null,
    posts: [],
    resultCount: 0,
    ...overrides,
  };
}

function clientReturning(
  pages: XSearchPage[],
): XRecentSearchClient & { searchRecent: ReturnType<typeof vi.fn> } {
  let index = 0;
  const searchRecent = vi.fn(async () => {
    const next = pages[index] ?? page();
    index += 1;
    return next;
  });
  return { searchRecent };
}

function insertsInto(
  query: ReturnType<typeof vi.fn>,
  table: RegExp,
): [string, unknown[]][] {
  return query.mock.calls.filter(([sql]) =>
    table.test(sql as string),
  ) as unknown as [string, unknown[]][];
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DISCOVERY_X_ENABLED;
});

describe("compareSnowflakeId", () => {
  it("orders snowflake ids by numeric magnitude", () => {
    expect(compareSnowflakeId("100", "99")).toBeGreaterThan(0);
    expect(compareSnowflakeId("99", "100")).toBeLessThan(0);
    expect(compareSnowflakeId("100", "100")).toBe(0);
  });
});

describe("harvestXInvites", () => {
  it("INGESTS a NEW community as source type x with the invite code", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool, query } = poolWith({ joined: [] });
    const injectImpl = vi.fn(async (_p, relay) =>
      candidateRecord(relay.host),
    ) as InjectCandidateFn;
    const client = clientReturning([
      page({
        newestId: "200",
        posts: [
          {
            createdAt: "2026-07-30T17:01:14.000Z",
            expandedUrls: [
              "https://newyork.communities.buzz.xyz/invite/v2.NYCODE",
            ],
            id: "200",
            text: "join my public new york buzz community",
          },
        ],
        resultCount: 1,
      }),
    ]);

    const result = await harvestXInvites({ client, injectImpl, pool });

    expect(result).toMatchObject({
      candidatesForExisting: 0,
      invitesFound: 1,
      newCommunitiesIngested: 1,
      pagesRead: 1,
      postsRead: 1,
    });
    expect(injectImpl).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        canonicalRelayUrl: "wss://newyork.communities.buzz.xyz",
        host: "newyork.communities.buzz.xyz",
      }),
      expect.objectContaining({
        evidenceId: "200",
        listing: { inviteCode: "v2.NYCODE" },
        locator: "https://x.com/i/status/200",
        type: "x",
      }),
    );
    // Success cursor advanced to newest_id.
    const successWrites = insertsInto(query, /discovery_source_state/);
    expect(successWrites.length).toBeGreaterThan(0);
  });

  it("records a SPARE when the invite is for a community we're already in", async () => {
    const { pool, query } = poolWith({
      joined: [
        {
          community_id: "id-1",
          relay_host: "hermesagent.communities.buzz.xyz",
          relay_url: "wss://hermesagent.communities.buzz.xyz",
        },
      ],
    });
    const injectImpl = vi.fn() as InjectCandidateFn;
    const client = clientReturning([
      page({
        newestId: "300",
        posts: [
          {
            expandedUrls: [
              "https://hermesagent.communities.buzz.xyz/invite/v2.FRESH",
            ],
            id: "300",
            text: "fresh hermes invite",
          },
        ],
        resultCount: 1,
      }),
    ]);

    const result = await harvestXInvites({ client, injectImpl, pool });

    expect(result.candidatesForExisting).toBe(1);
    expect(result.newCommunitiesIngested).toBe(0);
    expect(injectImpl).not.toHaveBeenCalled();
    const spareInserts = insertsInto(query, /harvested_invite_candidates/);
    expect(spareInserts).toHaveLength(1);
    expect(spareInserts[0]?.[1]).toEqual([
      "hermesagent.communities.buzz.xyz",
      "v2.FRESH",
      null,
    ]);
  });

  it("dedupes the same invite across posts in one tick", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool } = poolWith({ joined: [] });
    const injectImpl = vi.fn(async (_p, relay) =>
      candidateRecord(relay.host),
    ) as InjectCandidateFn;
    const client = clientReturning([
      page({
        newestId: "2",
        posts: [
          {
            expandedUrls: [
              "https://eco.communities.buzz.xyz/invite/SAME",
            ],
            id: "1",
            text: "a",
          },
          {
            expandedUrls: [
              "https://eco.communities.buzz.xyz/invite/SAME",
            ],
            id: "2",
            text: "b",
          },
        ],
        resultCount: 2,
      }),
    ]);

    const result = await harvestXInvites({ client, injectImpl, pool });
    expect(result.invitesFound).toBe(1);
    expect(result.newCommunitiesIngested).toBe(1);
    expect(injectImpl).toHaveBeenCalledTimes(1);
  });

  it("follows next_token for a multi-page catch-up within maxPages", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool } = poolWith({ joined: [] });
    const injectImpl = vi.fn(async (_p, relay) =>
      candidateRecord(relay.host),
    ) as InjectCandidateFn;
    const client = clientReturning([
      page({
        newestId: "10",
        nextToken: "tok2",
        posts: [
          {
            expandedUrls: ["https://a.communities.buzz.xyz/invite/A"],
            id: "10",
            text: "a",
          },
        ],
        resultCount: 1,
      }),
      page({
        newestId: "20",
        posts: [
          {
            expandedUrls: ["https://b.communities.buzz.xyz/invite/B"],
            id: "20",
            text: "b",
          },
        ],
        resultCount: 1,
      }),
    ]);

    const result = await harvestXInvites({ client, injectImpl, pool });
    expect(result.pagesRead).toBe(2);
    expect(result.newCommunitiesIngested).toBe(2);
    expect(client.searchRecent).toHaveBeenCalledTimes(2);
    // Second page should use next_token, not since_id alone.
    expect(client.searchRecent.mock.calls[1]?.[0]).toMatchObject({
      nextToken: "tok2",
      sinceId: null,
    });
  });

  it("records source failure and rethrows when X search fails", async () => {
    const { pool, query } = poolWith({ joined: [] });
    const client: XRecentSearchClient = {
      searchRecent: vi.fn(async () => {
        throw new Error("network down");
      }),
    };

    await expect(
      harvestXInvites({ client, pool }),
    ).rejects.toThrow("network down");

    const failureWrites = query.mock.calls.filter(
      ([sql]) =>
        typeof sql === "string" &&
        /discovery_source_state/i.test(sql) &&
        /last_error_code/i.test(sql),
    );
    expect(failureWrites.length).toBeGreaterThan(0);
  });

  it("extracts invites from expanded URLs when the tweet body only has t.co", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool } = poolWith({ joined: [] });
    const injectImpl = vi.fn(async (_p, relay) =>
      candidateRecord(relay.host),
    ) as InjectCandidateFn;
    const client = clientReturning([
      page({
        newestId: "9",
        posts: [
          {
            expandedUrls: [
              "https://vibecoding.communities.buzz.xyz/invite/VIBE1",
            ],
            id: "9",
            text: "Invite link https://t.co/short",
          },
        ],
        resultCount: 1,
      }),
    ]);

    await harvestXInvites({ client, injectImpl, pool });
    expect(injectImpl).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ host: "vibecoding.communities.buzz.xyz" }),
      expect.objectContaining({
        listing: { inviteCode: "VIBE1" },
        type: "x",
      }),
    );
  });
});

describe("registerHarvestXInvitesWorker", () => {
  it("no-ops when DISCOVERY_X_ENABLED is not true", async () => {
    const work = vi.fn(async (_queue, _opts, handler) => {
      await handler([{}]);
    });
    const boss = { work } as unknown as PgBoss;
    const pool = { query: vi.fn() } as unknown as Pool;

    await registerHarvestXInvitesWorker(boss, pool);

    expect(work).toHaveBeenCalledWith(
      SOURCE_X_QUEUE,
      { batchSize: 1 },
      expect.any(Function),
    );
    // Pool unused when disabled.
    expect(pool.query).not.toHaveBeenCalled();
  });
});
