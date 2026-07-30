import { describe, expect, it } from "vitest";

import {
  parseRelaySubmission,
  SubmissionValidationError,
} from "./validation";

describe("parseRelaySubmission", () => {
  it("reduces invite links to the canonical relay origin", () => {
    expect(
      parseRelaySubmission(
        "https://builders.communities.buzz.xyz/invite/private-token",
      ),
    ).toEqual({
      canonicalRelayUrl: "wss://builders.communities.buzz.xyz",
      host: "builders.communities.buzz.xyz",
      port: null,
    });
  });

  it.each([
    "",
    "not a URL",
    "file:///etc/passwd",
    "http://127.0.0.1",
    "http://[::1]",
  ])("rejects invalid public input %s", (value) => {
    expect(() => parseRelaySubmission(value)).toThrow(
      SubmissionValidationError,
    );
  });
});
