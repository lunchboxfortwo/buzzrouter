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
] as const;

export type FocusSlug = (typeof FOCUS_SLUGS)[number];

export const FOCUS_LABELS: Record<FocusSlug, string> = {
  building: "Building",
  "ai-agents": "AI & agents",
  "bitcoin-money": "Bitcoin & money",
  "design-creative": "Design & creative",
  "research-knowledge": "Research & knowledge",
  "local-regional": "Local & regional",
  "team-private": "Team & private",
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
