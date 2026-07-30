import { describe, expect, it } from "vitest";

import { isInternalReviewAuthorized } from "./auth";

describe("internal review authentication", () => {
  it("accepts the configured Basic credential", () => {
    const headers = new Headers({
      authorization: `Basic ${Buffer.from(
        "buzzrouter:correct-password",
      ).toString("base64")}`,
    });

    expect(
      isInternalReviewAuthorized(headers, "correct-password"),
    ).toBe(true);
  });

  it("rejects missing, malformed, and incorrect credentials", () => {
    expect(
      isInternalReviewAuthorized(new Headers(), "password"),
    ).toBe(false);
    expect(
      isInternalReviewAuthorized(
        new Headers({ authorization: "Bearer token" }),
        "password",
      ),
    ).toBe(false);
    expect(
      isInternalReviewAuthorized(
        new Headers({
          authorization: `Basic ${Buffer.from(
            "buzzrouter:wrong",
          ).toString("base64")}`,
        }),
        "password",
      ),
    ).toBe(false);
  });

  it("fails closed when no password is configured", () => {
    const headers = new Headers({
      authorization: `Basic ${Buffer.from(
        "buzzrouter:anything",
      ).toString("base64")}`,
    });

    expect(isInternalReviewAuthorized(headers, undefined)).toBe(false);
  });
});
