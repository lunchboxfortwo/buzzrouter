"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { setCandidateSuppressed, setListingCuration } from "../../../src/db/curation";
import { getDatabasePool } from "../../../src/db/pool";
import { isInternalReviewAuthorized } from "../../../src/internal/auth";
import { isFocusSlug } from "../../../src/ranking/focus";

const REVIEW_PATH = "/internal/discovery";

/**
 * The auth constant applied to curation writes made from the internal
 * console. `isInternalReviewAuthorized` only tells us the request carries a
 * valid shared password, not a per-operator identity, so every write from
 * this console is attributed to the same actor.
 */
const CURATED_BY = "internal-console";

/**
 * Server Actions get their own request, so the page's `notFound()`-on-
 * unauthorized gate has to be re-checked here rather than assumed from
 * rendering the page. This calls the exact same `isInternalReviewAuthorized`
 * helper the page uses, against the headers of the action's own request.
 */
async function assertAuthorized(): Promise<void> {
  const requestHeaders = await headers();
  if (!isInternalReviewAuthorized(requestHeaders)) {
    notFound();
  }
}

export async function curateListingAction(formData: FormData): Promise<void> {
  await assertAuthorized();

  const candidateId = requireString(formData, "candidateId");
  const focusValue = formData.get("focus");
  const focus =
    typeof focusValue === "string" && focusValue !== "" ? focusValue : null;
  if (focus !== null && !isFocusSlug(focus)) {
    throw new Error("Focus is invalid.");
  }

  const displayNameValue = formData.get("displayNameOverride");

  const pool = getDatabasePool();
  await setListingCuration(pool, {
    candidateId,
    curatedBy: CURATED_BY,
    displayNameOverride:
      typeof displayNameValue === "string" ? displayNameValue : null,
    focus,
  });

  revalidatePath(REVIEW_PATH);
}

export async function toggleSuppressionAction(
  formData: FormData,
): Promise<void> {
  await assertAuthorized();

  const candidateId = requireString(formData, "candidateId");
  const suppressed = formData.get("suppressed") === "true";

  const pool = getDatabasePool();
  await setCandidateSuppressed(pool, candidateId, suppressed, CURATED_BY);

  revalidatePath(REVIEW_PATH);
}

function requireString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value === "") {
    throw new Error(`${key} is required.`);
  }
  return value;
}
