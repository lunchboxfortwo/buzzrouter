import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  errorMessage,
  INTERNAL_ONLY_ERROR_CODES,
  KNOWN_API_ERROR_CODES,
} from "./error-message";

/**
 * An owner pasted a valid invite for a community that was already connected.
 * The API answered `409 {"error":"connection_already_active"}` — precise and
 * actionable — and the page rendered "The request could not be completed."
 * because the code was missing from the map. Nine codes were unmapped, and the
 * old version of this file asserted that blank fallback as correct.
 */
const ROOTS = [
  "src/shared-channels",
  "app/api/shared-channels",
  "app/api/community-connections",
];

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(walk(path));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function emittedCodes(): string[] {
  const codes = new Set<string>();
  const patterns = [
    /sharedChannelErrorResponse\(\s*"([a-z][a-z0-9_]+)"/g,
    /new ApiError\(\s*"([a-z][a-z0-9_]+)"/g,
    /\berror\(\s*\d{3},\s*"([a-z][a-z0-9_]+)"/g,
  ];
  for (const root of ROOTS) {
    let files: string[] = [];
    try {
      files = walk(root);
    } catch {
      continue; // a surface may not exist in every checkout
    }
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) codes.add(match[1]);
      }
    }
  }
  return [...codes];
}

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
    ["shared_channel_failed", "The hub connection could not be completed."],
  ])("maps %s to a readable sentence", (code, expected) => {
    expect(errorMessage(new Error(code))).toBe(expected);
  });

  it("tells an already-connected owner what to do instead of failing blankly", () => {
    const text = errorMessage(new Error("connection_already_active"));
    expect(text).toMatch(/already connected/i);
    expect(text).not.toMatch(/^The request could not be completed\.$/);
  });

  it("classifies every code the APIs emit as user-facing or internal", () => {
    const emitted = emittedCodes();
    expect(emitted.length).toBeGreaterThan(0); // the scan must actually find codes
    const unclassified = emitted.filter(
      (code) =>
        !KNOWN_API_ERROR_CODES.includes(code) &&
        !INTERNAL_ONLY_ERROR_CODES.includes(code),
    );
    expect(unclassified).toEqual([]);
  });

  it("names an unmapped code rather than hiding it", () => {
    expect(errorMessage(new Error("some_unmapped_code"))).toContain(
      "some_unmapped_code",
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
