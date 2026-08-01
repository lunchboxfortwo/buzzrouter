import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CandidateRecord } from "../db/candidates";
import type { NormalizedRelay } from "../discovery/normalize";
import type { JoinCommunityResult } from "../presence/policy";
import {
  processPendingValidations,
  type InjectCandidateFn,
  type JoinCommunityFn,
} from "./validate-submissions";

const KEY = Uint8Array.from([1, 2, 3]);

/** A pool that returns the given claimed rows and records resolve/membership. */
function makePool(
  claimed: {
    id: string;
    relay_host: string;
    relay_url: string;
    invite_code: string;
  }[],
): { pool: Pool; resolves: unknown[][]; memberships: unknown[][] } {
  const resolves: unknown[][] = [];
  const memberships: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SET status = 'processing'/.test(sql)) return { rows: claimed };
    if (/resolved_at = now\(\)/.test(sql)) {
      resolves.push(params);
      return { rows: [] };
    }
    if (/INSERT INTO presence_communities/.test(sql)) {
      memberships.push(params);
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { memberships, pool: { query } as unknown as Pool, resolves };
}

function row(host: string, code: string) {
  return {
    id: `val-${host}`,
    invite_code: code,
    relay_host: host,
    relay_url: `wss://${host}`,
  };
}

const inject: InjectCandidateFn = vi.fn(
  async (_pool, relay: NormalizedRelay): Promise<CandidateRecord> => ({
    canonicalRelayUrl: `wss://${relay.host}`,
    id: `cand-${relay.host}`,
    state: "verified_buzz",
  }),
);

afterEach(() => vi.restoreAllMocks());

describe("processPendingValidations", () => {
  it("marks a joinable invite valid, ingesting the candidate + membership", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool, resolves, memberships } = makePool([row("good.example", "OK")]);
    const joinImpl: JoinCommunityFn = vi.fn(
      async (): Promise<JoinCommunityResult> => ({
        body: { community_id: "cid-1" },
        ok: true,
        status: 200,
      }),
    );

    const result = await processPendingValidations({
      injectImpl: inject,
      joinImpl,
      pool,
      privateKey: KEY,
    });

    expect(result).toMatchObject({ invalid: 0, processed: 1, valid: 1 });
    // Resolved 'valid' with the ingested candidate id (params: id, status, candidateId, message).
    expect(resolves).toHaveLength(1);
    expect(resolves[0]?.[1]).toBe("valid");
    expect(resolves[0]?.[2]).toBe("cand-good.example");
    // Membership recorded with the community id from the join body.
    expect(memberships).toHaveLength(1);
  });

  it("treats an already-member response as valid", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { pool, resolves } = makePool([row("mine.example", "OK")]);
    const joinImpl: JoinCommunityFn = vi.fn(
      async (): Promise<JoinCommunityResult> => ({
        body: { error: "already a member" },
        ok: false,
        reason: "forbidden",
        status: 403,
      }),
    );

    const result = await processPendingValidations({
      injectImpl: inject,
      joinImpl,
      pool,
      privateKey: KEY,
    });

    expect(result).toMatchObject({ valid: 1 });
    expect(resolves[0]?.[1]).toBe("valid");
  });

  it("marks a rejected claim invalid without ingesting", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const injectSpy = vi.fn();
    const { pool, resolves, memberships } = makePool([row("dead.example", "X")]);
    const joinImpl: JoinCommunityFn = vi.fn(
      async (): Promise<JoinCommunityResult> => ({
        body: { error: "invite_expired" },
        ok: false,
        reason: "forbidden",
        status: 403,
      }),
    );

    const result = await processPendingValidations({
      injectImpl: injectSpy as unknown as InjectCandidateFn,
      joinImpl,
      pool,
      privateKey: KEY,
    });

    expect(result).toMatchObject({ invalid: 1, valid: 0 });
    expect(resolves[0]?.[1]).toBe("invalid");
    expect(injectSpy).not.toHaveBeenCalled();
    expect(memberships).toHaveLength(0);
  });

  it("marks a thrown join as error and keeps going", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { pool, resolves } = makePool([
      row("boom.example", "A"),
      row("ok.example", "B"),
    ]);
    const joinImpl: JoinCommunityFn = vi.fn(async ({ host }) => {
      if (host === "boom.example") throw new Error("relay unreachable");
      return { body: {}, ok: true, status: 200 } as JoinCommunityResult;
    });

    const result = await processPendingValidations({
      injectImpl: inject,
      joinImpl,
      pool,
      privateKey: KEY,
    });

    expect(result).toMatchObject({ errors: 1, processed: 2, valid: 1 });
    const errored = resolves.find((p) => p[1] === "error");
    expect(errored).toBeDefined();
  });
});
