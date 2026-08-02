import { describe, expect, it } from "vitest";

import { isUuid, requireUuid } from "./validation";

describe("UUID validation", () => {
  it("accepts canonical UUIDs", () => {
    const value = "11111111-1111-4111-8111-111111111111";

    expect(isUuid(value)).toBe(true);
    expect(requireUuid(value)).toBe(value);
  });

  it("rejects malformed identifiers with a stable API error", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(() => requireUuid("not-a-uuid")).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});
