import type { Event } from "nostr-tools/core";
import { verifyEvent } from "nostr-tools/pure";
import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  getSourceCursor,
  recordSourceFailure,
  recordSourceSuccess,
  type SourceCursor,
} from "../db/source-state";
import { hasCanonicalBuzzSoftware } from "../discovery/classifier";
import { parseNip11Document } from "../discovery/nip11";
import { SourceAdapterError } from "./errors";
import { ingestSourceCandidate } from "./ingest";
import type { NostrQueryClient } from "./nostr-client";

const SOURCE_KEY = "nip66";
const NIP66_KIND = 30_166;
const INITIAL_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
const QUERY_PAGE_SIZE = 500;
const MAX_EVENTS_PER_RUN = 10_000;
const MAX_PAGES_PER_RELAY = 20;
const MAX_QUERY_ATTEMPTS = 3;
const MAX_EVENT_TAGS = 100;
const MAX_NIP11_CONTENT_BYTES = 128 * 1_024;

export interface NostrTimestampCursor extends SourceCursor {
  since: number;
}

export interface Nip66SourceConfig {
  monitorPubkeys: string[];
  sourceRelays: string[];
}

export interface Nip66SourceResult {
  candidatesAccepted: number;
  candidatesIgnored: number;
  eventsRead: number;
}

export async function runNip66Source(
  pool: Pool,
  boss: PgBoss,
  client: NostrQueryClient,
  config: Nip66SourceConfig,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<Nip66SourceResult> {
  if (config.monitorPubkeys.length < 2) {
    throw new SourceAdapterError(
      "invalid_configuration",
      "NIP-66 requires at least two independent monitor keys.",
    );
  }

  const cursor = sanitizeTimestampCursor(
    await getSourceCursor<NostrTimestampCursor>(
      pool,
      SOURCE_KEY,
      { since: nowSeconds - INITIAL_LOOKBACK_SECONDS },
    ),
    nowSeconds - INITIAL_LOOKBACK_SECONDS,
    nowSeconds,
  );
  const result: Nip66SourceResult = {
    candidatesAccepted: 0,
    candidatesIgnored: 0,
    eventsRead: 0,
  };

  try {
    const events = await queryNip66Events(
      client,
      config,
      cursor.since,
      nowSeconds,
    );
    result.eventsRead = events.length;
    let latestTimestamp: number | null = null;

    for (const event of events) {
      if (event.created_at < cursor.since) {
        result.candidatesIgnored += 1;
        continue;
      }

      if (
        isTrustedNip66Envelope(
          event,
          config.monitorPubkeys,
          nowSeconds,
        )
      ) {
        latestTimestamp = Math.max(
          latestTimestamp ?? event.created_at,
          event.created_at,
        );
      }

      const candidate = parseNip66Candidate(
        event,
        config.monitorPubkeys,
        nowSeconds,
      );
      if (!candidate) {
        result.candidatesIgnored += 1;
        continue;
      }

      const ingestion = await ingestSourceCandidate(pool, boss, candidate);
      if (ingestion.accepted) {
        result.candidatesAccepted += 1;
      } else {
        result.candidatesIgnored += 1;
      }
    }

    await recordSourceSuccess(
      pool,
      SOURCE_KEY,
      {
        since:
          latestTimestamp === null
            ? cursor.since
            : latestTimestamp,
      },
      result,
    );
    return result;
  } catch (error) {
    if (error instanceof SourceAdapterError) {
      await recordSourceFailure(pool, SOURCE_KEY, error.code);
      throw error;
    }

    await recordSourceFailure(pool, SOURCE_KEY, "remote_failed");
    throw new SourceAdapterError(
      "remote_failed",
      "NIP-66 source reconciliation failed.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function queryNip66Events(
  client: NostrQueryClient,
  config: Nip66SourceConfig,
  since: number,
  until: number,
): Promise<Event[]> {
  const events = new Map<string, Event>();

  for (const sourceRelay of config.sourceRelays) {
    for (const monitorPubkey of config.monitorPubkeys) {
      let pageUntil = until;
      let completed = false;

      for (
        let page = 0;
        page < MAX_PAGES_PER_RELAY;
        page += 1
      ) {
        const batch = await queryNip66Page(
          client,
          sourceRelay,
          monitorPubkey,
          since,
          pageUntil,
        );
        addBoundedEvents(events, batch);

        if (batch.length < QUERY_PAGE_SIZE) {
          completed = true;
          break;
        }

        const oldestTimestamp = Math.min(
          ...batch.map((event) => event.created_at),
        );
        const boundary = await queryNip66Page(
          client,
          sourceRelay,
          monitorPubkey,
          oldestTimestamp,
          oldestTimestamp,
        );
        if (boundary.length >= QUERY_PAGE_SIZE) {
          throw new SourceAdapterError(
            "incomplete_results",
            "NIP-66 has too many events at one timestamp to paginate safely.",
          );
        }
        addBoundedEvents(events, boundary);

        pageUntil = oldestTimestamp - 1;
        if (pageUntil < since) {
          completed = true;
          break;
        }
      }

      if (!completed) {
        throw new SourceAdapterError(
          "incomplete_results",
          "NIP-66 exceeded its bounded pagination window.",
        );
      }
    }
  }

  return [...events.values()];
}

async function queryNip66Page(
  client: NostrQueryClient,
  sourceRelay: string,
  monitorPubkey: string,
  since: number,
  until: number,
): Promise<Event[]> {
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= MAX_QUERY_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await client.query([sourceRelay], {
        authors: [monitorPubkey],
        kinds: [NIP66_KIND],
        limit: QUERY_PAGE_SIZE,
        since,
        until,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("NIP-66 query failed.");
}

function addBoundedEvents(
  target: Map<string, Event>,
  events: Event[],
): void {
  for (const event of events) {
    target.set(event.id, event);
    if (target.size > MAX_EVENTS_PER_RUN) {
      throw new SourceAdapterError(
        "incomplete_results",
        "NIP-66 exceeded its aggregate event limit.",
      );
    }
  }
}

export function parseNip66Candidate(
  event: Event,
  allowedMonitorPubkeys: string[],
  nowSeconds: number,
) {
  if (!isTrustedNip66Envelope(event, allowedMonitorPubkeys, nowSeconds)) {
    return null;
  }
  if (
    event.tags.length > MAX_EVENT_TAGS ||
    Buffer.byteLength(event.content) > MAX_NIP11_CONTENT_BYTES
  ) {
    return null;
  }

  const network = event.tags.find((tag) => tag[0] === "n")?.[1];
  if (network && network !== "clearnet") {
    return null;
  }

  const relayUrl = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (!relayUrl || !event.content) {
    return null;
  }

  try {
    const nip11 = parseNip11Document(JSON.parse(event.content));
    if (!hasCanonicalBuzzSoftware(nip11.software)) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    relayUrl,
    source: {
      type: "nip66" as const,
      actorPubkey: event.pubkey,
      evidenceId: event.id,
      observedAt: new Date(event.created_at * 1_000),
    },
  };
}

export function isTrustedNip66Envelope(
  event: Event,
  allowedMonitorPubkeys: string[],
  nowSeconds: number,
): boolean {
  return (
    event.kind === NIP66_KIND &&
    allowedMonitorPubkeys.includes(event.pubkey) &&
    event.created_at >= 0 &&
    event.created_at <= nowSeconds + 300 &&
    isVerifiedEvent(event)
  );
}

function isVerifiedEvent(event: Event): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}

export function sanitizeTimestampCursor(
  cursor: NostrTimestampCursor,
  fallbackSince: number,
  nowSeconds: number,
): NostrTimestampCursor {
  if (
    !Number.isInteger(cursor.since) ||
    cursor.since < 0 ||
    cursor.since > nowSeconds + 300
  ) {
    return { since: fallbackSince };
  }

  return cursor;
}
