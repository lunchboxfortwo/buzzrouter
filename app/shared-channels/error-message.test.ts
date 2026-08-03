import { describe, expect, it } from "vitest";

import { errorMessage } from "./error-message";

describe("errorMessage", () => {
  it.each([
    ["connection_required", "The community connector must be active first."],
    [
      "connector_package_unavailable",
      "The connector package is temporarily unavailable. Try again shortly.",
    ],
    [
      "install_token_unavailable",
      "That connection session has expired or was already used. Request a new one.",
    ],
    ["authentication_invalid", "The signed request was not accepted."],
    [
      "shared_channel_failed",
      "The shared-channel request could not be completed.",
    ],
  ])("maps %s to a readable sentence", (code, expected) => {
    expect(errorMessage(new Error(code))).toBe(expected);
  });

  it("falls back to a generic sentence for an unmapped code", () => {
    expect(errorMessage(new Error("some_unmapped_code"))).toBe(
      "The request could not be completed.",
    );
  });

  it("passes through an already human-readable message", () => {
    expect(errorMessage(new Error("A Nostr signer is required."))).toBe(
      "A Nostr signer is required.",
    );
  });

  it("handles non-Error values", () => {
    expect(errorMessage("boom")).toBe("Request failed.");
  });
});
