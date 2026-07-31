import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CandidateRecord } from "../db/candidates";
import type { NormalizedRelay } from "../discovery/normalize";
import type { PresenceMessage } from "../presence/reader";
import {
  harvestInvites,
  registerHarvestInvitesWorker,
  type InjectCandidateFn,
  type ReadCommunityFn,
} from "./harvest-invites";
import { HARVEST_INVITES_QUEUE } from "./queues";

// Mock the default dependency modules so the real worker handler (which calls
// `harvestInvites({ pool })` with no injected deps) never touches the network
// or a real Postgres connection.
const mockReadCommunity = vi.fn();
vi.mock("../presence/reader", () => ({
  readCommunity: (...args: unknown[]) => mockReadCommunity(...args),
}));
const mockUpsertCandidate = vi.fn();
vi.mock("../db/candidates", () => ({
  upsertCandidate: (...args: unknown[]) => mockUpsertCandidate(...args),
}));

/** A CandidateRecord an ingestion returns for a given relay. */
function candidateRecord(host: string): CandidateRecord {
  return { canonicalRelayUrl: `wss://${host}`, id: `cand-${host}`, state: "discovered" };
}

/**
 * A pool whose SELECT returns the given already-joined rows and whose
 * INSERT/UPDATE calls resolve empty, recording every call.
 */
function poolWith(
  rows: { relay_host: string; relay_url: string; community_id: string | null }[],
): { pool: Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (sql: string) => {
    if (/^\s*SELECT/i.test(sql)) return { rows };
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, query };
}

/** Builds a PresenceMessage carrying the given content. */
function message(content: string): PresenceMessage {
  return {
    channelId: "chan-1",
    content,
    createdAt: 1,
    id: "evt-1",
    pubkey: "pub-1",
  };
}

/** A reader stub returning a fixed message list for any relay it is asked. */
function readerReturning(
  byRelay: Record<string, PresenceMessage[]>,
): ReadCommunityFn {
  return vi.fn(async ({ relayUrl }) => byRelay[relayUrl] ?? []);
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
  mockReadCommunity.mockReset();
  mockUpsertCandidate.mockReset();
});

describe("harvestInvites", () => {
  it("INGESTS a NEW community as a directory candidate instead of joining", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Agent is a member of home.example; a message there advertises new.example.
    const { pool, query } = poolWith([
      { community_id: "id-home", relay_host: "home.example", relay_url: "wss://home.example" },
    ]);
    const readCommunity = readerReturning({
      "wss://home.example": [
        message("welcome! buzz://join?relay=wss://new.example&code=INV-NEW"),
      ],
    });
    const injectImpl: InjectCandidateFn = vi.fn(
      async (_pool, relay: NormalizedRelay): Promise<CandidateRecord> =>
        candidateRecord(relay.host),
    );

    const result = await harvestInvites({ injectImpl, pool, readCommunity });

    expect(result).toEqual({
      candidatesForExisting: 0,
      failed: 0,
      invitesFound: 1,
      newCommunitiesIngested: 1,
      scannedCommunities: 1,
    });
    // Ingested via upsertCandidate with source_type harvest + the invite code,
    // canonicalized to wss://new.example. No join, no membership row.
    expect(injectImpl).toHaveBeenCalledTimes(1);
    expect(injectImpl).toHaveBeenCalledWith(
      pool,
      { canonicalRelayUrl: "wss://new.example", host: "new.example", port: null },
      {
        evidenceId: "new.example",
        listing: { inviteCode: "INV-NEW" },
        type: "harvest",
      },
    );
    expect(insertsInto(query, /INSERT INTO presence_communities/)).toHaveLength(0);
    expect(insertsInto(query, /INSERT INTO harvested_invite_candidates/)).toHaveLength(
      0,
    );
  });

  it("records a candidate (no ingest) when the invite is for a community we're in", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Member of both home.example and existing.example; home advertises existing.
    const { pool, query } = poolWith([
      { community_id: null, relay_host: "home.example", relay_url: "wss://home.example" },
      { community_id: null, relay_host: "existing.example", relay_url: "wss://existing.example" },
    ]);
    const readCommunity = readerReturning({
      "wss://home.example": [
        message("re-up: https://existing.example/invite/FRESH-CODE"),
      ],
      "wss://existing.example": [],
    });
    const injectImpl = vi.fn();

    const result = await harvestInvites({ injectImpl, pool, readCommunity });

    expect(result).toEqual({
      candidatesForExisting: 1,
      failed: 0,
      invitesFound: 1,
      newCommunitiesIngested: 0,
      scannedCommunities: 2,
    });
    // No ingest for an already-joined community.
    expect(injectImpl).not.toHaveBeenCalled();
    // Candidate recorded with the harvested code + source host.
    const candidateInserts = insertsInto(
      query,
      /INSERT INTO harvested_invite_candidates/,
    );
    expect(candidateInserts).toHaveLength(1);
    expect(candidateInserts[0]?.[1]).toEqual([
      "existing.example",
      "FRESH-CODE",
      "home.example",
    ]);
  });

  it("isolates a per-invite ingest failure so the rest still process", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { pool } = poolWith([
      { community_id: null, relay_host: "home.example", relay_url: "wss://home.example" },
    ]);
    const readCommunity = readerReturning({
      "wss://home.example": [
        message("buzz://join?relay=wss://good.example&code=code-good"),
        message("buzz://join?relay=wss://bad.example&code=code-bad"),
      ],
    });
    const injectImpl: InjectCandidateFn = vi.fn(
      async (_pool, relay: NormalizedRelay): Promise<CandidateRecord> => {
        if (relay.host === "bad.example") {
          throw new Error("ingest exploded");
        }
        return candidateRecord(relay.host);
      },
    );

    const result = await harvestInvites({ injectImpl, pool, readCommunity });

    expect(result).toEqual({
      candidatesForExisting: 0,
      failed: 1,
      invitesFound: 2,
      newCommunitiesIngested: 1,
      scannedCommunities: 1,
    });
    // The failure is logged with the host; the invite code never appears.
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("bad.example");
    expect(logged).not.toContain("code-bad");
  });

  it("isolates a community whose read fails and counts it as failed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { pool } = poolWith([
      { community_id: null, relay_host: "ok.example", relay_url: "wss://ok.example" },
      { community_id: null, relay_host: "down.example", relay_url: "wss://down.example" },
    ]);
    const readCommunity = vi.fn(async ({ relayUrl }) => {
      if (relayUrl === "wss://down.example") {
        throw new Error("relay unreachable");
      }
      return [message("buzz://join?relay=wss://new.example&code=NEW")];
    }) as unknown as ReadCommunityFn;
    const injectImpl: InjectCandidateFn = vi.fn(
      async (_pool, relay: NormalizedRelay): Promise<CandidateRecord> =>
        candidateRecord(relay.host),
    );

    const result = await harvestInvites({ injectImpl, pool, readCommunity });

    expect(result).toEqual({
      candidatesForExisting: 0,
      failed: 1,
      invitesFound: 1,
      newCommunitiesIngested: 1,
      scannedCommunities: 2,
    });
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("down.example");
  });

  it("de-duplicates the same invite seen in multiple channels/communities", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool } = poolWith([
      { community_id: null, relay_host: "a.example", relay_url: "wss://a.example" },
      { community_id: null, relay_host: "b.example", relay_url: "wss://b.example" },
    ]);
    // Both communities advertise the SAME new invite.
    const readCommunity = readerReturning({
      "wss://a.example": [message("buzz://join?relay=wss://new.example&code=DUP")],
      "wss://b.example": [message("https://new.example/invite/DUP")],
    });
    const injectImpl: InjectCandidateFn = vi.fn(
      async (_pool, relay: NormalizedRelay): Promise<CandidateRecord> =>
        candidateRecord(relay.host),
    );

    const result = await harvestInvites({ injectImpl, pool, readCommunity });

    expect(result.invitesFound).toBe(1);
    expect(result.newCommunitiesIngested).toBe(1);
    expect(injectImpl).toHaveBeenCalledTimes(1);
  });
});

describe("registerHarvestInvitesWorker", () => {
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

  it("registers on the harvest queue with a single-batch worker", async () => {
    const { pool } = poolWith([]);
    const { boss } = fakeBoss();
    await registerHarvestInvitesWorker(boss, pool);
    expect(boss.work).toHaveBeenCalledWith(
      HARVEST_INVITES_QUEUE,
      { batchSize: 1 },
      expect.any(Function),
    );
  });

  it("runs the real handler and ingests a harvested new community", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Member of home.example, whose channel advertises a NEW community.
    const { pool } = poolWith([
      { community_id: null, relay_host: "home.example", relay_url: "wss://home.example" },
    ]);
    const { boss, run, send } = fakeBoss();
    mockReadCommunity.mockResolvedValue([
      message("buzz://join?relay=wss://new.example&code=NEW"),
    ]);
    mockUpsertCandidate.mockResolvedValue(candidateRecord("new.example"));

    await registerHarvestInvitesWorker(boss, pool);
    await run();

    expect(mockUpsertCandidate).toHaveBeenCalledWith(
      pool,
      { canonicalRelayUrl: "wss://new.example", host: "new.example", port: null },
      expect.objectContaining({ type: "harvest" }),
    );
    // Ingested candidates are not joined, so nothing is chained.
    expect(send).not.toHaveBeenCalled();
  });

  it("runs the real handler and ingests nothing when no invites are seen", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool } = poolWith([
      { community_id: null, relay_host: "home.example", relay_url: "wss://home.example" },
    ]);
    const { boss, run, send } = fakeBoss();
    mockReadCommunity.mockResolvedValue([]);

    await registerHarvestInvitesWorker(boss, pool);
    await run();

    expect(mockUpsertCandidate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
