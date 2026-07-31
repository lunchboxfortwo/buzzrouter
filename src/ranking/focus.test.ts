import { describe, expect, it } from "vitest";

import {
  FOCUS_LABELS,
  FOCUS_SLUGS,
  focusLabel,
  isFocusSlug,
} from "./focus";

describe("isFocusSlug", () => {
  it("accepts every declared slug", () => {
    for (const slug of FOCUS_SLUGS) {
      expect(isFocusSlug(slug)).toBe(true);
    }
  });

  it.each([null, undefined, "", "unknown-slug", 42, {}])(
    "rejects %s",
    (value) => {
      expect(isFocusSlug(value)).toBe(false);
    },
  );
});

describe("focusLabel", () => {
  it("round-trips every slug to its human label", () => {
    for (const slug of FOCUS_SLUGS) {
      expect(focusLabel(slug)).toBe(FOCUS_LABELS[slug]);
    }
  });

  it("falls back to Uncategorized for null", () => {
    expect(focusLabel(null)).toBe("Uncategorized");
  });

  it("falls back to Uncategorized for an unknown slug", () => {
    expect(focusLabel("not-a-real-slug")).toBe("Uncategorized");
  });
});
