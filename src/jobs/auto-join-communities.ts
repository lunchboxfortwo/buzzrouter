import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import { listJoinedCommunities, upsertMembership } from "../db/presence";
import { loadAgentIdentity } from "../presence/identity";
import {
  joinCommunity as defaultJoinCommunity,
  type JoinCommunityOptions,
  type JoinCommunityResult,
} from "../presence/policy";
import { AUTO_JOIN_QUEUE, REFRESH_SUMMARIES_QUEUE } from "./queues";

/**
 * Auto-joins every joinable community advertised by the public directory that
 * the BuzzRouter Agent is not already a member of.
 *
 * The job reads the directory's `GET /api/communities?joinable=true` feed (every
 * community a user could join — anything with a code the probe did not find
 * owner-only/allowlist), skips any host already recorded in
 * `presence_communities`, and for each remaining community that carries an
 * invite code claims the invite as the agent —
 * explicitly accepting Block's Terms of Service plus the 18+ age attestation
 * (`acceptTerms: true`; this is authorized/counsel-approved). A successful join
 * records the membership so the recurring 4h summary refresh picks the community
 * up.
 *
 * Every community is processed under its own try/catch so a single failure never
 * aborts the batch, and only the bare host (never a key, receipt, or invite
 * code) is logged.
 */

/** A joinable community as advertised by the public directory API. */
export interface JoinableCommunity {
  host: string;
  relayUrl: string;
  displayName?: string;
  description?: string;
  focus?: string;
  categories?: string[];
  joinMode?: string;
  inviteCode?: string;
  publicUrl?: string;
  lastVerifiedAt?: string;
  slug?: string;
}

export type JoinCommunityFn = (
  options: JoinCommunityOptions,
) => Promise<JoinCommunityResult>;

export interface AutoJoinDeps {
  pool: Pool;
  /** Directory origin; defaults to PUBLIC_APP_ORIGIN or https://buzzrouter.com. */
  apiOrigin?: string;
  /** Injectable HTTP client; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Agent private key; defaults to the loaded agent identity's key. */
  privateKey?: Uint8Array;
  /** Injectable join implementation; defaults to the real policy handshake. */
  joinImpl?: JoinCommunityFn;
}

export interface AutoJoinResult {
  attempted: number;
  joined: number;
  alreadyJoined: number;
  skippedNoCode: number;
  failed: number;
}

const DEFAULT_ORIGIN = "https://buzzrouter.com";

/** Builds the joinable-communities directory endpoint from an origin. */
export function joinableCommunitiesEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/communities?joinable=true`;
}

/**
 * Fetches and normalizes the joinable-communities feed. Accepts either a bare
 * JSON array or a `{ communities: [...] }` envelope and keeps only entries that
 * carry both a `host` and a `relayUrl` (everything else is unusable for a join).
 */
export async function fetchJoinableCommunities(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<JoinableCommunity[]> {
  const url = joinableCommunitiesEndpoint(origin);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch joinable communities from ${url}: HTTP ${response.status}.`,
    );
  }
  const parsed = (await response.json()) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as { communities?: unknown }).communities
      : undefined;
  if (!Array.isArray(list)) {
    throw new Error(`Malformed joinable communities response from ${url}.`);
  }
  const communities: JoinableCommunity[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const host = record.host;
    const relayUrl = record.relayUrl;
    if (typeof host !== "string" || host.length === 0) continue;
    if (typeof relayUrl !== "string" || relayUrl.length === 0) continue;
    const community: JoinableCommunity = { host, relayUrl };
    if (typeof record.inviteCode === "string" && record.inviteCode.length > 0) {
      community.inviteCode = record.inviteCode;
    }
    if (typeof record.displayName === "string") {
      community.displayName = record.displayName;
    }
    if (typeof record.slug === "string") community.slug = record.slug;
    communities.push(community);
  }
  return communities;
}

/**
 * True when a failed claim response indicates the agent is already a member.
 * Buzz answers a duplicate claim with an "already a member" style message; we
 * treat that as a benign no-op rather than a failure.
 */
export function isAlreadyMember(result: JoinCommunityResult): boolean {
  if (result.ok) return false;
  const body = "body" in result ? result.body : undefined;
  const text = memberText(body);
  return /already\s+(a\s+)?(member|joined)|already\s+in/.test(text);
}

function memberText(body: unknown): string {
  if (typeof body === "string") return body.toLowerCase();
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    for (const key of ["error", "reason", "message", "detail"]) {
      const value = record[key];
      if (typeof value === "string") return value.toLowerCase();
    }
  }
  return "";
}

function communityIdFromBody(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null) {
    const value = (body as Record<string, unknown>).community_id;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export async function autoJoinCommunities(
  deps: AutoJoinDeps,
): Promise<AutoJoinResult> {
  const origin =
    deps.apiOrigin ?? process.env.PUBLIC_APP_ORIGIN ?? DEFAULT_ORIGIN;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const joinImpl = deps.joinImpl ?? defaultJoinCommunity;
  const privateKey = deps.privateKey ?? loadAgentIdentity().privateKey;

  const result: AutoJoinResult = {
    alreadyJoined: 0,
    attempted: 0,
    failed: 0,
    joined: 0,
    skippedNoCode: 0,
  };

  const communities = await fetchJoinableCommunities(origin, fetchImpl);
  const joined = await listJoinedCommunities(deps.pool);
  const joinedHosts = new Set(joined.map((c) => c.relayHost));

  for (const community of communities) {
    if (joinedHosts.has(community.host)) {
      result.alreadyJoined += 1;
      continue;
    }
    if (!community.inviteCode) {
      result.skippedNoCode += 1;
      continue;
    }

    result.attempted += 1;
    try {
      const outcome = await joinImpl({
        acceptTerms: true,
        code: community.inviteCode,
        host: community.host,
        privateKey,
      });

      if (outcome.ok) {
        await upsertMembership(deps.pool, {
          communityId: communityIdFromBody(outcome.body),
          relayHost: community.host,
          relayUrl: community.relayUrl,
        });
        result.joined += 1;
        console.log(`${AUTO_JOIN_QUEUE}: joined ${community.host}`);
        continue;
      }

      if (isAlreadyMember(outcome)) {
        // Already a member (e.g. a membership row was lost): record it and
        // count it as already-joined rather than a failure.
        await upsertMembership(deps.pool, {
          relayHost: community.host,
          relayUrl: community.relayUrl,
        });
        result.alreadyJoined += 1;
        console.log(
          `${AUTO_JOIN_QUEUE}: already a member of ${community.host}`,
        );
        continue;
      }

      result.failed += 1;
      console.error(
        `${AUTO_JOIN_QUEUE}: failed ${community.host}: ${outcome.reason}`,
      );
    } catch (error) {
      result.failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`${AUTO_JOIN_QUEUE}: failed ${community.host}: ${reason}`);
    }
  }

  return result;
}

/**
 * Registers the pg-boss worker that drains the auto-join schedule. Mirrors
 * `registerRefreshSummariesWorker`: a single-batch worker that runs one join
 * pass per fired job, and — when it joined at least one new community — enqueues
 * a summary refresh so the freshly joined communities get summarized right away
 * instead of waiting for the next 4h tick.
 */
export async function registerAutoJoinWorker(
  boss: PgBoss,
  pool: Pool,
): Promise<void> {
  await boss.work(AUTO_JOIN_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const _job of jobs) {
      const tally = await autoJoinCommunities({ pool });
      console.log(
        `${AUTO_JOIN_QUEUE}: attempted=${tally.attempted} ` +
          `joined=${tally.joined} alreadyJoined=${tally.alreadyJoined} ` +
          `skippedNoCode=${tally.skippedNoCode} failed=${tally.failed}`,
      );
      if (tally.joined > 0) {
        await boss.send(REFRESH_SUMMARIES_QUEUE, null);
      }
    }
  });
}
