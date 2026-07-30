import type { Pool } from "pg";

import { isUuid } from "../claims/http";
import { isFocusSlug } from "../ranking/focus";

const DISPLAY_NAME_OVERRIDE_MAX_LENGTH = 120;

export interface SetListingCurationInput {
  candidateId: string;
  curatedBy: string;
  displayNameOverride?: string | null;
  focus?: string | null;
}

/**
 * Upserts operator curation onto `communities`, keyed by `candidate_id`.
 * Most candidates have no `communities` row yet (one is only created today
 * during the claim flow), so this always inserts a bare `visibility =
 * 'internal'` row when needed rather than requiring one to exist first.
 *
 * A field that is *omitted* from `input` is left untouched on an existing
 * row. A field explicitly passed as `null` clears it. That distinction is
 * carried by `hasOwnProperty`, not by the resolved value, since both cases
 * resolve to `null` on the wire.
 */
export async function setListingCuration(
  pool: Pool,
  input: SetListingCurationInput,
): Promise<void> {
  if (!isUuid(input.candidateId)) {
    throw new Error("Candidate id is invalid.");
  }

  const curatedBy = input.curatedBy?.trim();
  if (!curatedBy) {
    throw new Error("curatedBy is required.");
  }

  const setFocus = Object.prototype.hasOwnProperty.call(input, "focus");
  const focus = setFocus ? (input.focus ?? null) : null;
  if (focus !== null && !isFocusSlug(focus)) {
    throw new Error("Focus is invalid.");
  }

  const setDisplayNameOverride = Object.prototype.hasOwnProperty.call(
    input,
    "displayNameOverride",
  );
  const displayNameOverride = setDisplayNameOverride
    ? normalizeDisplayNameOverride(input.displayNameOverride ?? null)
    : null;

  await pool.query(
    `
      INSERT INTO communities (
        candidate_id,
        focus,
        display_name_override,
        curated_at,
        curated_by
      )
      VALUES ($1, $2, $3, now(), $4)
      ON CONFLICT (candidate_id) DO UPDATE
        SET focus = CASE
              WHEN $5 THEN EXCLUDED.focus
              ELSE communities.focus
            END,
            display_name_override = CASE
              WHEN $6 THEN EXCLUDED.display_name_override
              ELSE communities.display_name_override
            END,
            curated_at = EXCLUDED.curated_at,
            curated_by = EXCLUDED.curated_by,
            updated_at = now()
    `,
    [
      input.candidateId,
      focus,
      displayNameOverride,
      curatedBy,
      setFocus,
      setDisplayNameOverride,
    ],
  );
}

function normalizeDisplayNameOverride(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("Display name override is invalid.");
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  if (trimmed.length > DISPLAY_NAME_OVERRIDE_MAX_LENGTH) {
    throw new Error(
      `Display name override must be ${DISPLAY_NAME_OVERRIDE_MAX_LENGTH} characters or fewer.`,
    );
  }
  return trimmed;
}

/**
 * Suppresses or restores a candidate's public-directory eligibility.
 *
 * Restoring never asserts 'verified_buzz': a candidate may have been
 * suppressed from any state, and promoting it would claim a verification the
 * pipeline never made. Instead it returns to 'discovered' and is queued for an
 * immediate probe, so the classifier re-derives the real state from evidence.
 * The curation record is touched in the same statement so
 * `curated_at`/`curated_by` reflect the decision without clobbering any
 * `focus` or `display_name_override` already set.
 */
export async function setCandidateSuppressed(
  pool: Pool,
  candidateId: string,
  suppressed: boolean,
  curatedBy: string,
): Promise<void> {
  if (!isUuid(candidateId)) {
    throw new Error("Candidate id is invalid.");
  }

  const trimmedCuratedBy = curatedBy?.trim();
  if (!trimmedCuratedBy) {
    throw new Error("curatedBy is required.");
  }

  const targetState = suppressed ? "suppressed" : "discovered";

  await pool.query(
    `
      WITH updated_candidate AS (
        UPDATE community_candidates
        SET state = $2,
            next_probe_at = CASE WHEN $2 = 'suppressed' THEN next_probe_at ELSE now() END
        WHERE id = $1
        RETURNING id
      )
      INSERT INTO communities (candidate_id, curated_at, curated_by)
      SELECT id, now(), $3
      FROM updated_candidate
      ON CONFLICT (candidate_id) DO UPDATE
        SET curated_at = EXCLUDED.curated_at,
            curated_by = EXCLUDED.curated_by,
            updated_at = now()
    `,
    [candidateId, targetState, trimmedCuratedBy],
  );
}
