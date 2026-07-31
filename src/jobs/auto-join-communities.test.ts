import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  JoinCommunityOptions,
  JoinCommunityResult,
} from "../presence/policy";
import {
  autoJoinCommunities,
  isAlreadyMember,
  registerAutoJoinWorker,
  type JoinableCommunity,
} from "./auto-join-communities";
import { AUTO_JOIN_QUEUE, REFRESH_SUMMARIES_QUEUE } from "./queues";

const KEY = Uint8Array.from([1, 2, 3]);

/** A fetch stub that returns the given communities feed as JSON. */
function fetchReturning(payload: unknown): typeof fetch {
  return vi.fn(async () => ({
    json: async () => payload,
    ok: true,
    status: 200,
  })) as unknown as typeof fetch;
}

/** A pool whose SELECT returns the given already-joined rows and whose
 * INSERT/UPDATE calls resolve empty, recording every call. */
function poolWith(
  rows: { relay_host: string; relay_url: string; community_id: string | null }[],
): { pool: Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (sql: string) => {
    if (/SELECT/i.test(sql)) return { rows };
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, query };
}

function community(
  overrides: Partial<JoinableCommunity> & { host: string },
): JoinableCommunity {
  return {
    relayUrl: `wss://${overrides.host}`,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("autoJoinCommunities", () => {
  it("joins every joinable community it is not already in and records membership", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const feed = [
      community({ host: "a.example", inviteCode: "code-a" }),
      community({ host: "b.example", inviteCode: "code-b" }),
      // Already joined — must be skipped.
      community({ host: "c.example", inviteCode: "code-c" }),
      // No invite code — must be skipped as skippedNoCode.
      community({ host: "d.example" }),
    ];
    const { pool, query } = poolWith([
      { community_id: "cc", relay_host: "c.example", relay_url: "wss://c.example" },
    ]);

    const joinImpl = vi.fn(
      async (options: JoinCommunityOptions): Promise<JoinCommunityResult> => ({
        body: { community_id: `id-${options.host}` },
        ok: true,
        status: 200,
      }),
    );

    const result = await autoJoinCommunities({
      fetchImpl: fetchReturning(feed),
      joinImpl,
      pool,
      privateKey: KEY,
    });

    expect(result).toEqual({
      alreadyJoined: 1,
      attempted: 2,
      failed: 0,
      joined: 2,
      skippedNoCode: 1,
    });

    // Only a.example and b.example are actually claimed, with acceptTerms:true.
    expect(joinImpl).toHaveBeenCalledTimes(2);
    expect(joinImpl).toHaveBeenCalledWith({
      acceptTerms: true,
      code: "code-a",
      host: "a.example",
      privateKey: KEY,
    });
    expect(joinImpl).toHaveBeenCalledWith({
      acceptTerms: true,
      code: "code-b",
      host: "b.example",
      privateKey: KEY,
    });
    // c.example (already joined) is never attempted.
    for (const call of joinImpl.mock.calls) {
      expect(call[0].host).not.toBe("c.example");
    }

    // Membership rows are upserted with the community_id parsed from the body.
    const inserts = query.mock.calls.filter(([sql]) =>
      /INSERT INTO presence_communities/.test(sql as string),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.[1]).toEqual([
      "a.example",
      "wss://a.example",
      "id-a.example",
    ]);
    expect(inserts[1]?.[1]).toEqual([
      "b.example",
      "wss://b.example",
      "id-b.example",
    ]);
  });

  it("treats an already-a-member claim response as success without erroring", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const feed = [community({ host: "m.example", inviteCode: "code-m" })];
    const { pool, query } = poolWith([]);

    const joinImpl = vi.fn(
      async (): Promise<JoinCommunityResult> => ({
        body: { error: "You are already a member of this community" },
        ok: false,
        reason: "invalid",
        status: 409,
      }),
    );

    const result = await autoJoinCommunities({
      fetchImpl: fetchReturning(feed),
      joinImpl,
      pool,
      privateKey: KEY,
    });

    expect(result).toEqual({
      alreadyJoined: 1,
      attempted: 1,
      failed: 0,
      joined: 0,
      skippedNoCode: 0,
    });
    // Membership still recorded, and no error logged.
    const inserts = query.mock.calls.filter(([sql]) =>
      /INSERT INTO presence_communities/.test(sql as string),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]?.[0]).toBe("m.example");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("isolates a failing community so the rest still join", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const feed = [
      community({ host: "good.example", inviteCode: "code-g" }),
      community({ host: "bad.example", inviteCode: "code-b" }),
      community({ host: "throw.example", inviteCode: "code-t" }),
    ];
    const { pool, query } = poolWith([]);

    const joinImpl = vi.fn(
      async (options: JoinCommunityOptions): Promise<JoinCommunityResult> => {
        if (options.host === "bad.example") {
          return { ok: false, reason: "expired", status: 410 };
        }
        if (options.host === "throw.example") {
          throw new Error("network exploded");
        }
        return { body: { community_id: "id-good" }, ok: true, status: 200 };
      },
    );

    const result = await autoJoinCommunities({
      fetchImpl: fetchReturning(feed),
      joinImpl,
      pool,
      privateKey: KEY,
    });

    expect(result).toEqual({
      alreadyJoined: 0,
      attempted: 3,
      failed: 2,
      joined: 1,
      skippedNoCode: 0,
    });
    // Only the healthy community produced a membership row.
    const inserts = query.mock.calls.filter(([sql]) =>
      /INSERT INTO presence_communities/.test(sql as string),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]?.[0]).toBe("good.example");
    // Both failures logged with the host; the invite code never appears.
    expect(errorSpy).toHaveBeenCalledTimes(2);
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("bad.example");
    expect(logged).toContain("throw.example");
    expect(logged).not.toContain("code-b");
    expect(logged).not.toContain("code-t");
  });

  it("accepts the { communities: [...] } envelope shape", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const feed = { communities: [community({ host: "e.example", inviteCode: "c" })] };
    const { pool } = poolWith([]);
    const joinImpl = vi.fn(
      async (): Promise<JoinCommunityResult> => ({
        body: {},
        ok: true,
        status: 200,
      }),
    );

    const result = await autoJoinCommunities({
      fetchImpl: fetchReturning(feed),
      joinImpl,
      pool,
      privateKey: KEY,
    });

    expect(result.joined).toBe(1);
    expect(joinImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when the directory responds non-2xx", async () => {
    const { pool } = poolWith([]);
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({}),
      ok: false,
      status: 503,
    })) as unknown as typeof fetch;

    await expect(
      autoJoinCommunities({
        fetchImpl,
        joinImpl: vi.fn(),
        pool,
        privateKey: KEY,
      }),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("isAlreadyMember", () => {
  it("detects an already-a-member body", () => {
    expect(
      isAlreadyMember({
        body: { error: "Already a member" },
        ok: false,
        reason: "invalid",
        status: 409,
      }),
    ).toBe(true);
  });

  it("does not flag an unrelated failure or a success", () => {
    expect(
      isAlreadyMember({
        body: { error: "invite expired" },
        ok: false,
        reason: "expired",
        status: 410,
      }),
    ).toBe(false);
    expect(isAlreadyMember({ body: {}, ok: true, status: 200 })).toBe(false);
  });
});

describe("registerAutoJoinWorker", () => {
  const originalFetch = globalThis.fetch;
  const originalOrigin = process.env.PUBLIC_APP_ORIGIN;
  const originalKey = process.env.BUZZ_AGENT_KEY;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalOrigin === undefined) delete process.env.PUBLIC_APP_ORIGIN;
    else process.env.PUBLIC_APP_ORIGIN = originalOrigin;
    if (originalKey === undefined) delete process.env.BUZZ_AGENT_KEY;
    else process.env.BUZZ_AGENT_KEY = originalKey;
  });

  /** Captures the handler pg-boss would register, and records `send` calls. */
  function fakeBoss(): {
    boss: PgBoss;
    send: ReturnType<typeof vi.fn>;
    run: () => Promise<void>;
  } {
    const send = vi.fn().mockResolvedValue("job-id");
    let handler: ((jobs: unknown[]) => Promise<void>) | undefined;
    const boss = {
      send,
      work: vi.fn(async (_queue, _opts, fn) => {
        handler = fn;
      }),
    } as unknown as PgBoss;
    return {
      boss,
      run: async () => {
        if (!handler) throw new Error("worker was never registered");
        await handler([{ id: "job-1" }]);
      },
      send,
    };
  }

  it("registers on the auto-join queue with a single-batch worker", async () => {
    const { pool } = poolWith([]);
    const { boss } = fakeBoss();
    await registerAutoJoinWorker(boss, pool);
    expect(boss.work).toHaveBeenCalledWith(
      AUTO_JOIN_QUEUE,
      { batchSize: 1 },
      expect.any(Function),
    );
  });

  it("runs a join pass and chains a refresh when something new was joined", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.PUBLIC_APP_ORIGIN = "https://directory.test";
    process.env.BUZZ_AGENT_KEY = "1".repeat(64);
    const { pool } = poolWith([]);
    const { boss, run, send } = fakeBoss();

    // A single global fetch stub serves both the directory feed and the claim
    // endpoint, so no real network is touched.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/communities")) {
        return {
          json: async () => [
            community({ host: "new.example", inviteCode: "code-n" }),
          ],
          ok: true,
          status: 200,
        } as unknown as Response;
      }
      // The invite claim succeeds outright (no join policy needed).
      return {
        status: 200,
        text: async () => JSON.stringify({ community_id: "id-new" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await registerAutoJoinWorker(boss, pool);
    await run();

    // joined > 0 => a summary refresh is enqueued.
    expect(send).toHaveBeenCalledWith(REFRESH_SUMMARIES_QUEUE, null);
  });

  it("does not chain a refresh when nothing new was joined", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.PUBLIC_APP_ORIGIN = "https://directory.test";
    process.env.BUZZ_AGENT_KEY = "1".repeat(64);
    // The only listed community is already joined.
    const { pool } = poolWith([
      { community_id: "id-x", relay_host: "x.example", relay_url: "wss://x.example" },
    ]);
    const { boss, run, send } = fakeBoss();

    globalThis.fetch = vi.fn(async () => ({
      json: async () => [community({ host: "x.example", inviteCode: "code-x" })],
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    await registerAutoJoinWorker(boss, pool);
    await run();

    expect(send).not.toHaveBeenCalled();
  });
});
