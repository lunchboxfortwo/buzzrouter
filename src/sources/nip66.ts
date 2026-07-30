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
const MAX_EVENTS_PER_RUN = 1_000;
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
    const events = await client.query(config.sourceRelays, {
      authors: config.monitorPubkeys,
      kinds: [NIP66_KIND],
      limit: MAX_EVENTS_PER_RUN,
      since: cursor.since,
    });
    if (events.length >= MAX_EVENTS_PER_RUN) {
      throw new SourceAdapterError(
        "incomplete_results",
        "NIP-66 reached its event limit without a complete batch.",
      );
    }
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
