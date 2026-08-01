/**
 * Same category vocabulary the directory already filters/tags communities
 * with (source_categories / communities.categories, 0005_catalog_discovery.sql).
 * Kept import-free so it is safe to use from client components.
 */
export const SUBMISSION_CATEGORY_SLUGS = [
  "bitcoin",
  "builders",
  "culture",
  "gtm",
  "labs",
  "privacy",
] as const;

export type SubmissionCategorySlug = (typeof SUBMISSION_CATEGORY_SLUGS)[number];
