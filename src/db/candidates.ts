import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { sanitizeSourceLocator } from "../discovery/source-locator";
import type { RelayProbeResult } from "../discovery/probe";
import type { NormalizedRelay } from "../discovery/normalize";
import { parsePublicIconDataUri, type PublicRelayIcon } from "../discovery/nip11";
import { isFocusSlug, type FocusSlug } from "../ranking/focus";
import { SUBMISSION_CATEGORY_SLUGS } from "../submissions/categories";

export const SOURCE_TYPES = [
  "reviewed_seed",
  "github",
  "nip65",
  "nip66",
  "provider",
  "manual",
  "buzzdir",
  "submission",
  "harvest",
  "x",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export interface CandidateSource {
  type: SourceType;
  locator?: string;
  actorPubkey?: string;
  evidenceId?: string;
  observedAt?: Date;
  listing?: CandidateSourceListing;
}

export interface CandidateSourceListing {
  audience?: string;
  categories?: string[];
  contactEmail?: string;
  description?: string;
  displayName?: string;
  focus?: string;
  inviteCode?: string | null;
  publicUrl?: string | null;
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
  const evidenceHash = createEvidenceHash(
    relay.canonicalRelayUrl,
    source,
    locator,
  );
  const listing = normalizeCandidateSourceListing(source.listing);
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
              next_probe_at = CASE
                WHEN $3 = 'submission'
                  AND community_candidates.last_seen_at >=
                    now() - interval '1 hour'
                  THEN community_candidates.next_probe_at
                ELSE LEAST(
                  community_candidates.next_probe_at,
                  now()
                )
              END
        RETURNING id, canonical_relay_url, state
      `,
      [relay.canonicalRelayUrl, relay.host, source.type],
    );

    const row = candidate.rows[0];
    await client.query(
      `
        INSERT INTO community_sources (
          candidate_id,
          source_type,
          source_locator,
          source_actor_pubkey,
          source_observed_at,
          evidence_hash,
          source_display_name,
          source_description,
          source_categories,
          source_public_url,
          source_invite_code,
          source_contact_email,
          source_audience,
          source_focus
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (candidate_id, source_type, evidence_hash) DO UPDATE
          SET last_seen_at = now(),
              source_observed_at = GREATEST(
                community_sources.source_observed_at,
                EXCLUDED.source_observed_at
              ),
              source_display_name = EXCLUDED.source_display_name,
              source_description = EXCLUDED.source_description,
              source_categories = EXCLUDED.source_categories,
              source_public_url = EXCLUDED.source_public_url,
              source_invite_code = EXCLUDED.source_invite_code,
              source_contact_email = EXCLUDED.source_contact_email,
              source_audience = EXCLUDED.source_audience,
              source_focus = EXCLUDED.source_focus
      `,
      [
        row.id,
        source.type,
        locator,
        source.actorPubkey ?? null,
        source.observedAt ?? new Date(),
        evidenceHash,
        listing.displayName,
        listing.description,
        listing.categories,
        listing.publicUrl,
        listing.inviteCode,
        listing.contactEmail,
        listing.audience,
        listing.focus,
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

export function normalizeCandidateSourceListing(
  listing: CandidateSourceListing | undefined,
): {
  audience: string | null;
  categories: string[];
  contactEmail: string | null;
  description: string | null;
  displayName: string | null;
  focus: FocusSlug | null;
  inviteCode: string | null;
  publicUrl: string | null;
} {
  const displayName = normalizePublicRelayText(listing?.displayName, 80);
  const description = normalizePublicRelayText(listing?.description, 500);
  const audience = normalizePublicRelayText(listing?.audience, 300);
  const publicUrl =
    typeof listing?.publicUrl === "string" && /^https:\/\//i.test(listing.publicUrl)
      ? listing.publicUrl.slice(0, 500)
      : null;
  const inviteCode =
    typeof listing?.inviteCode === "string" && listing.inviteCode.trim()
      ? listing.inviteCode.trim().slice(0, 200)
      : null;
  const contactEmail =
    typeof listing?.contactEmail === "string" &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(listing.contactEmail.trim()) &&
    listing.contactEmail.trim().length <= 254
      ? listing.contactEmail.trim().toLowerCase()
      : null;
  const focus = isFocusSlug(listing?.focus) ? listing.focus : null;
  const categories = [
    ...new Set(
      (listing?.categories ?? [])
        .map((category) => category.trim().toLowerCase())
        .filter((category) =>
          (SUBMISSION_CATEGORY_SLUGS as readonly string[]).includes(
            category,
          ),
        ),
    ),
  ].slice(0, 5);

  return {
    audience,
    categories,
    contactEmail,
    description,
    displayName:
      displayName && Array.from(displayName).length >= 2
        ? displayName
        : null,
    focus,
    inviteCode,
    publicUrl,
  };
}

export function createEvidenceHash(
  canonicalRelayUrl: string,
  source: CandidateSource,
  sanitizedLocator = sanitizeSourceLocator(source.locator),
): string {
  const evidenceIdentity =
    source.actorPubkey ??
    source.evidenceId ??
    sanitizedLocator ??
    canonicalRelayUrl;
  const identity = [source.type, evidenceIdentity].join(":");

  return createHash("sha256").update(identity).digest("hex");
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
      const publicIcon = parsePublicIconDataUri(result.nip11.icon);
      await client.query(
        `
          INSERT INTO probe_snapshots (
            candidate_id,
            http_status,
            ws_open_ms,
            tls_valid,
            relay_name,
            relay_description,
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
            $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12,
            $13, $14
          )
        `,
        [
          candidateId,
          result.httpStatus,
          result.websocketOpenMs,
          result.tlsValid,
          normalizePublicRelayText(result.nip11.name, 120),
          normalizePublicRelayText(result.nip11.description, 1_000),
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
      if (publicIcon) {
        await upsertCommunityIcon(client, candidateId, publicIcon);
      } else {
        await client.query(
          "DELETE FROM community_icons WHERE candidate_id = $1",
          [candidateId],
        );
      }
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

/**
 * One icon row per candidate (community_icons.candidate_id is the PK), so a
 * later write always replaces the previous one — used by both the NIP-11
 * probe path above and a submitter's direct upload
 * (app/api/submissions/route.ts). The `content_hash IS DISTINCT FROM` guard
 * makes re-submitting the identical image a true no-op.
 */
export async function upsertCommunityIcon(
  queryable: Pool | PoolClient,
  candidateId: string,
  icon: PublicRelayIcon,
): Promise<void> {
  await queryable.query(
    `
      INSERT INTO community_icons (
        candidate_id,
        content_type,
        image_bytes,
        content_hash
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (candidate_id) DO UPDATE
        SET content_type = EXCLUDED.content_type,
            image_bytes = EXCLUDED.image_bytes,
            content_hash = EXCLUDED.content_hash,
            updated_at = now()
        WHERE community_icons.content_hash IS DISTINCT FROM EXCLUDED.content_hash
    `,
    [candidateId, icon.contentType, icon.bytes, icon.contentHash],
  );
}

export function normalizePublicRelayText(
  value: string | undefined,
  maximumLength: number,
): string | null {
  if (!Number.isInteger(maximumLength) || maximumLength < 1) {
    throw new Error("Public relay text limit must be a positive integer.");
  }

  const normalized = value?.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return null;
  }

  return Array.from(normalized).slice(0, maximumLength).join("");
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
