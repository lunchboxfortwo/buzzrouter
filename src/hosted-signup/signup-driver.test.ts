import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightSignupDriver } from "./signup-driver";

describe("PlaywrightSignupDriver live-egress gate", () => {
  const original = process.env.BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE;
    } else {
      process.env.BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE = original;
    }
  });

  it("refuses to construct against the real host without the flag (defaults OFF)", () => {
    delete process.env.BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE;
    expect(() => new PlaywrightSignupDriver()).toThrowError(
      /BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE/,
    );
  });

  it("constructs only once the flag is explicitly set (the flag is the gate)", () => {
    process.env.BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE = "1";
    expect(
      () =>
        new PlaywrightSignupDriver({
          baseUrl: "https://fake.builderlab.test/api/goose",
          origin: "https://fake.builderlab.test",
          signupUrl: "https://fake.builderlab.test",
        }),
    ).not.toThrow();
  });
});
