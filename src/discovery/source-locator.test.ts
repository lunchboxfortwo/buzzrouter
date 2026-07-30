import { describe, expect, it } from "vitest";

import { sanitizeSourceLocator } from "./source-locator";

describe("sanitizeSourceLocator", () => {
  it("removes invite paths, query strings, and fragments", () => {
    expect(
      sanitizeSourceLocator(
        "https://relay.example.com/invite/private?code=secret#fragment",
      ),
    ).toBe("https://relay.example.com/");
  });

  it("retains a public GitHub evidence path", () => {
    expect(
      sanitizeSourceLocator(
        "https://github.com/example/repo/issues/12?utm_source=test",
      ),
    ).toBe("https://github.com/example/repo/issues/12");
  });

  it("rejects credentials and non-HTTPS evidence", () => {
    expect(() =>
      sanitizeSourceLocator("https://user:secret@example.com/source"),
    ).toThrow("public HTTPS URL");
    expect(() =>
      sanitizeSourceLocator("http://example.com/source"),
    ).toThrow("public HTTPS URL");
  });
});
