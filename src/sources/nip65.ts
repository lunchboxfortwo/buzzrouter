import type { Event } from "nostr-tools/core";
import { verifyEvent } from "nostr-tools/pure";
import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  getSourceCursor,
  recordSourceFailure,
  recordSourceSuccess,
} from "../db/source-state";
import { SourceAdapterError } from "./errors";
import { ingestSourceCandidate, type SourceCandidate } from "./ingest";
import type { NostrQueryClient } from "./nostr-client";
import {
  sanitizeTimestampCursor,
  type NostrTimestampCursor,
} from "./nip66";

const SOURCE_KEY = "nip65";
const NIP65_KIND = 10_002;
const MAX_EVENTS_PER_RUN = 500;
const MAX_RELAY_TAGS_PER_EVENT = 20;
const MAX_EVENT_TAGS = 100;

export interface Nip65SourceConfig {
  authors: string[];
  sourceRelays: string[];
}

export interface Nip65SourceResult {
  candidatesAccepted: number;
  candidatesIgnored: number;
  eventsRead: number;
}

export async function runNip65Source(
  pool: Pool,
  boss: PgBoss,
  client: NostrQueryClient,
  config: Nip65SourceConfig,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<Nip65SourceResult> {
  if (config.authors.length === 0 || config.authors.length > 500) {
    throw new SourceAdapterError(
      "invalid_configuration",
      "NIP-65 requires 1-500 allowlisted authors.",
    );
  }

  const cursor = sanitizeTimestampCursor(
    await getSourceCursor<NostrTimestampCursor>(
      pool,
      SOURCE_KEY,
      { since: 0 },
    ),
    0,
    nowSeconds,
  );
  const result: Nip65SourceResult = {
    candidatesAccepted: 0,
    candidatesIgnored: 0,
    eventsRead: 0,
  };

  try {
    const events = await client.query(config.sourceRelays, {
      authors: config.authors,
      kinds: [NIP65_KIND],
      limit: MAX_EVENTS_PER_RUN,
      since: cursor.since,
    });
    if (events.length >= MAX_EVENTS_PER_RUN) {
      throw new SourceAdapterError(
        "incomplete_results",
        "NIP-65 reached its event limit without a complete batch.",
      );
    }
    result.eventsRead = events.length;
    let latestTimestamp: number | null = null;

    for (const event of events) {
      if (event.created_at < cursor.since) {
        result.candidatesIgnored += 1;
        continue;
      }

      if (isTrustedNip65Envelope(event, config.authors, nowSeconds)) {
        latestTimestamp = Math.max(
          latestTimestamp ?? event.created_at,
          event.created_at,
        );
      }
      const candidates = parseNip65Candidates(
        event,
        config.authors,
        nowSeconds,
      );

      for (const candidate of candidates) {
        const ingestion = await ingestSourceCandidate(pool, boss, candidate);
        if (ingestion.accepted) {
          result.candidatesAccepted += 1;
        } else {
          result.candidatesIgnored += 1;
        }
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
      "NIP-65 source reconciliation failed.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export function parseNip65Candidates(
  event: Event,
  allowedAuthors: string[],
  nowSeconds = Math.floor(Date.now() / 1_000),
): SourceCandidate[] {
  if (!isTrustedNip65Envelope(event, allowedAuthors, nowSeconds)) {
    return [];
  }
  if (event.tags.length > MAX_EVENT_TAGS) {
    return [];
  }

  return event.tags
    .filter((tag) => tag[0] === "r" && typeof tag[1] === "string")
    .slice(0, MAX_RELAY_TAGS_PER_EVENT)
    .map((tag) => ({
      relayUrl: tag[1],
      source: {
        type: "nip65" as const,
        actorPubkey: event.pubkey,
        evidenceId: event.id,
        observedAt: new Date(event.created_at * 1_000),
      },
    }));
}

export function isTrustedNip65Envelope(
  event: Event,
  allowedAuthors: string[],
  nowSeconds: number,
): boolean {
  return (
    event.kind === NIP65_KIND &&
    allowedAuthors.includes(event.pubkey) &&
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
