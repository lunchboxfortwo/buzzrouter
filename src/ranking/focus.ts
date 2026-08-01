/**
 * Focus is operator-curated, not inferred. It is the single vocabulary
 * shared by the internal curation console and any public rendering of it,
 * so the slug <-> label mapping lives in exactly one place.
 */
export const FOCUS_SLUGS = [
  "building",
  "ai-agents",
  "bitcoin-money",
  "design-creative",
  "research-knowledge",
  "local-regional",
  "team-private",
  "privacy-security",
  "growth-gtm",
] as const;

export type FocusSlug = (typeof FOCUS_SLUGS)[number];

// One-word labels: the directory list (mobile especially) is dense, and every
// focus renders beside a community name, so a single word reads faster and frees
// real estate. Slugs are unchanged — only the human labels shorten.
export const FOCUS_LABELS: Record<FocusSlug, string> = {
  building: "Building",
  "ai-agents": "AI",
  "bitcoin-money": "Bitcoin",
  "design-creative": "Design",
  "research-knowledge": "Research",
  "local-regional": "Local",
  "team-private": "Team",
  "privacy-security": "Privacy",
  "growth-gtm": "Growth",
};

export function isFocusSlug(value: unknown): value is FocusSlug {
  return (
    typeof value === "string" &&
    (FOCUS_SLUGS as readonly string[]).includes(value)
  );
}

export function focusLabel(slug: string | null): string {
  if (!isFocusSlug(slug)) {
    return "Uncategorized";
  }
  return FOCUS_LABELS[slug];
}
