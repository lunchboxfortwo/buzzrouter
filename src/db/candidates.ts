import { createHash } from "node:crypto";

import type { Pool } from "pg";

import type { RelayProbeResult } from "../discovery/probe";
import type { NormalizedRelay } from "../discovery/normalize";

export const SOURCE_TYPES = [
  "reviewed_seed",
  "github",
  "nip65",
  "nip66",
  "provider",
  "manual",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export interface CandidateSource {
  type: SourceType;
  locator?: string;
  actorPubkey?: string;
}

export interface CandidateRecord {
  id: string;
  canonicalRelayUrl: string;
  state: string;
}

export async function upsertCandidate(
  pool: Pool,
  relay: NormalizedRelay,
  source: CandidateSource,
): Promise<CandidateRecord> {
  const locator = sanitizeSourceLocator(source.locator);
  const evidenceHash = createHash("sha256")
    .update(`${source.type}:${locator ?? relay.canonicalRelayUrl}`)
    .digest("hex");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const candidate = await client.query<{
      id: string;
      canonical_relay_url: string;
      state: string;
    }>(
      `
        INSERT INTO community_candidates (
          canonical_relay_url,
          host
        )
        VALUES ($1, $2)
        ON CONFLICT (canonical_relay_url) DO UPDATE
          SET last_seen_at = now(),
              next_probe_at = LEAST(
                community_candidates.next_probe_at,
                now()
              )
        RETURNING id, canonical_relay_url, state
      `,
      [relay.canonicalRelayUrl, relay.host],
    );

    const row = candidate.rows[0];
    await client.query(
      `
        INSERT INTO community_sources (
          candidate_id,
          source_type,
          source_locator,
          source_actor_pubkey,
          evidence_hash
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (candidate_id, source_type, evidence_hash) DO UPDATE
          SET last_seen_at = now()
      `,
      [
        row.id,
        source.type,
        locator,
        source.actorPubkey ?? null,
        evidenceHash,
      ],
    );
    await client.query("COMMIT");

    return {
      id: row.id,
      canonicalRelayUrl: row.canonical_relay_url,
      state: row.state,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCandidate(
  pool: Pool,
  candidateId: string,
): Promise<CandidateRecord | null> {
  const result = await pool.query<{
    id: string;
    canonical_relay_url: string;
    state: string;
  }>(
    `
      SELECT id, canonical_relay_url, state
      FROM community_candidates
      WHERE id = $1
        AND state <> 'suppressed'
    `,
    [candidateId],
  );
  const row = result.rows[0];

  return row
    ? {
        id: row.id,
        canonicalRelayUrl: row.canonical_relay_url,
        state: row.state,
      }
    : null;
}

export async function markCandidateProbing(
  pool: Pool,
  candidateId: string,
): Promise<void> {
  await pool.query(
    `
      UPDATE community_candidates
      SET state = CASE
            WHEN state = 'discovered' THEN 'probing'
            ELSE state
          END,
          last_seen_at = now()
      WHERE id = $1
        AND state <> 'suppressed'
    `,
    [candidateId],
  );
}

export async function recordProbeResult(
  pool: Pool,
  candidateId: string,
  result: RelayProbeResult,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (!result.ok) {
      await client.query(
        `
          INSERT INTO probe_snapshots (
            candidate_id,
            result_code
          )
          VALUES ($1, $2)
        `,
        [candidateId, result.resultCode],
      );
      await client.query(
        `
          UPDATE community_candidates
          SET state = CASE
                WHEN classifier_version IS NULL THEN 'discovered'
                ELSE state
              END,
              classifier_reason = $2,
              next_probe_at = now() + interval '24 hours'
          WHERE id = $1
            AND state <> 'suppressed'
        `,
        [candidateId, result.resultCode],
      );
    } else {
      await client.query(
        `
          INSERT INTO probe_snapshots (
            candidate_id,
            http_status,
            ws_open_ms,
            tls_valid,
            software,
            software_version,
            supported_nips,
            relay_self_pubkey,
            auth_required,
            restricted_writes,
            icon_hash,
            result_code
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12
          )
        `,
        [
          candidateId,
          result.httpStatus,
          result.websocketOpenMs,
          result.tlsValid,
          result.nip11.software ?? null,
          result.nip11.version ?? null,
          JSON.stringify(result.nip11.supportedNips),
          result.nip11.relaySelfPubkey ?? null,
          result.nip11.limitation.authRequired ?? null,
          result.nip11.limitation.restrictedWrites ?? null,
          result.iconHash,
          result.classification.reason,
        ],
      );
      await client.query(
        `
          UPDATE community_candidates
          SET state = $2,
              classifier_version = $3,
              classifier_reason = $4,
              next_probe_at = now() + interval '24 hours'
          WHERE id = $1
            AND state <> 'suppressed'
        `,
        [
          candidateId,
          result.classification.state,
          result.classification.classifierVersion,
          result.classification.reason,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimDueCandidateIds(
  pool: Pool,
  limit = 100,
): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Due candidate limit must be between 1 and 1000.");
  }

  const result = await pool.query<{ id: string }>(
    `
      WITH due AS (
        SELECT id
        FROM community_candidates
        WHERE next_probe_at <= now()
          AND state <> 'suppressed'
        ORDER BY next_probe_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE community_candidates AS candidates
      SET next_probe_at = now() + interval '15 minutes'
      FROM due
      WHERE candidates.id = due.id
      RETURNING candidates.id
    `,
    [limit],
  );

  return result.rows.map((row) => row.id);
}

export function sanitizeSourceLocator(locator: string | undefined):
  | string
  | null {
  if (!locator) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(locator);
  } catch {
    throw new Error("Source locator must be a public HTTPS URL.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Source locator must be a public HTTPS URL.");
  }

  const inviteIndex = parsed.pathname.toLowerCase().indexOf("/invite/");
  if (inviteIndex >= 0) {
    parsed.pathname = parsed.pathname.slice(0, inviteIndex) || "/";
  }

  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}
