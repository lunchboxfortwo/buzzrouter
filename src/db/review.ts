import type { Pool } from "pg";

import {
  evaluateListingEligibility,
  type ListingEligibility,
} from "../discovery/listing-eligibility";
import type { SourceType } from "./candidates";

export interface ReviewSource {
  actorPubkey: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  locator: string | null;
  observedAt: string;
  type: SourceType;
}

export interface ReviewProbe {
  probedAt: string;
  resultCode: string;
  tlsValid: boolean;
  websocketOpenMs: number | null;
}

export interface CandidateReview {
  canonicalRelayUrl: string;
  classifierReason: string | null;
  eligibility: ListingEligibility;
  firstSeenAt: string;
  id: string;
  lastSeenAt: string;
  nextProbeAt: string;
  recentProbes: ReviewProbe[];
  sources: ReviewSource[];
  state: string;
}

export interface SourceStateReview {
  key: string;
  lastErrorCode: string | null;
  lastResult: Record<string, unknown>;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
}

export async function listCandidateReviews(
  pool: Pool,
  limit = 100,
): Promise<CandidateReview[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Review limit must be between 1 and 500.");
  }

  const candidates = await pool.query<{
    canonical_relay_url: string;
    classifier_reason: string | null;
    first_seen_at: Date;
    id: string;
    last_seen_at: Date;
    next_probe_at: Date;
    state: string;
  }>(
    `
      SELECT
        id,
        canonical_relay_url,
        state,
        first_seen_at,
        last_seen_at,
        next_probe_at,
        classifier_reason
      FROM community_candidates
      ORDER BY last_seen_at DESC, id
      LIMIT $1
    `,
    [limit],
  );
  const ids = candidates.rows.map((candidate) => candidate.id);
  if (ids.length === 0) {
    return [];
  }

  const [sources, probes] = await Promise.all([
    pool.query<{
      candidate_id: string;
      first_seen_at: Date;
      last_seen_at: Date;
      source_actor_pubkey: string | null;
      source_locator: string | null;
      source_observed_at: Date;
      source_type: SourceType;
    }>(
      `
        SELECT
          candidate_id,
          source_type,
          source_locator,
          source_actor_pubkey,
          source_observed_at,
          first_seen_at,
          last_seen_at
        FROM community_sources
        WHERE candidate_id = ANY($1::uuid[])
        ORDER BY candidate_id, source_type, first_seen_at
      `,
      [ids],
    ),
    pool.query<{
      candidate_id: string;
      probed_at: Date;
      result_code: string;
      tls_valid: boolean;
      ws_open_ms: number | null;
    }>(
      `
        SELECT
          candidate_id,
          probed_at,
          result_code,
          tls_valid,
          ws_open_ms
        FROM (
          SELECT
            candidate_id,
            probed_at,
            result_code,
            tls_valid,
            ws_open_ms,
            row_number() OVER (
              PARTITION BY candidate_id
              ORDER BY probed_at DESC
            ) AS row_number
          FROM probe_snapshots
          WHERE candidate_id = ANY($1::uuid[])
        ) ranked
        WHERE row_number <= 5
        ORDER BY candidate_id, probed_at DESC
      `,
      [ids],
    ),
  ]);

  return candidates.rows.map((candidate) => {
    const candidateSources = sources.rows
      .filter((source) => source.candidate_id === candidate.id)
      .map((source) => ({
        actorPubkey: source.source_actor_pubkey,
        firstSeenAt: source.first_seen_at.toISOString(),
        lastSeenAt: source.last_seen_at.toISOString(),
        locator: source.source_locator,
        observedAt: source.source_observed_at.toISOString(),
        type: source.source_type,
      }));
    const recentProbes = probes.rows
      .filter((probe) => probe.candidate_id === candidate.id)
      .map((probe) => ({
        probedAt: probe.probed_at.toISOString(),
        resultCode: probe.result_code,
        tlsValid: probe.tls_valid,
        websocketOpenMs: probe.ws_open_ms,
      }));

    return {
      canonicalRelayUrl: candidate.canonical_relay_url,
      classifierReason: candidate.classifier_reason,
      eligibility: evaluateListingEligibility(
        candidate.state,
        candidateSources.map((source) => ({
          actorPubkey: source.actorPubkey,
          observedAt: source.observedAt,
          type: source.type,
        })),
        {
          latestProbe: recentProbes[0] ?? null,
        },
      ),
      firstSeenAt: candidate.first_seen_at.toISOString(),
      id: candidate.id,
      lastSeenAt: candidate.last_seen_at.toISOString(),
      nextProbeAt: candidate.next_probe_at.toISOString(),
      recentProbes,
      sources: candidateSources,
      state: candidate.state,
    };
  });
}

export async function listSourceStateReviews(
  pool: Pool,
): Promise<SourceStateReview[]> {
  const result = await pool.query<{
    last_error_code: string | null;
    last_result: Record<string, unknown>;
    last_run_at: Date | null;
    last_success_at: Date | null;
    source_key: string;
  }>(`
    SELECT
      source_key,
      last_run_at,
      last_success_at,
      last_error_code,
      last_result
    FROM discovery_source_state
    ORDER BY source_key
  `);

  return result.rows.map((source) => ({
    key: source.source_key,
    lastErrorCode: source.last_error_code,
    lastResult: source.last_result,
    lastRunAt: source.last_run_at?.toISOString() ?? null,
    lastSuccessAt: source.last_success_at?.toISOString() ?? null,
  }));
}
