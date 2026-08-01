import { describe, expect, it } from "vitest";

import { isExpiringSoon, parseInviteExpiry } from "./invite-expiry";

/** Builds a `<base64url-payload>.<sig>` token whose payload carries the fields. */
function token(payload: Record<string, unknown>, sig = "sig"): string {
  const base64url = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${base64url}.${sig}`;
}

describe("parseInviteExpiry", () => {
  it("reads the `e` expiry out of a real-shaped token", () => {
    // The exact creatormagic code decoded during the investigation.
    const code =
      "eyJjIjoiYTczMjczNTMtYzExOS00OWNiLWE4ZjQtNTI3YzY4NmQyMDlkIiwiciI6Im1lbWJlciIsImUiOjE3ODc3NTQ4MTksIm4iOiJOYmZvWm5TSzRlUVpZc1pTSnlHVkx3In0.waEPhDSFQrfaxlxqGCuqkWFxfZiiI-9JpuGKvkI4dUk";
    expect(parseInviteExpiry(code)).toBe(1787754819);
  });

  it("round-trips an arbitrary payload's expiry", () => {
    expect(parseInviteExpiry(token({ c: "x", e: 1800000000, r: "member" }))).toBe(
      1800000000,
    );
  });

  it("returns null for a v2-style opaque code (no readable expiry)", () => {
    expect(
      parseInviteExpiry("v2.umQGOlbNHvzs5fDVgxWCcU1N6ZmKr_3QAqPiuM4AgV4"),
    ).toBeNull();
  });

  it("returns null when the payload has no numeric `e`", () => {
    expect(parseInviteExpiry(token({ c: "x", r: "member" }))).toBeNull();
    expect(parseInviteExpiry(token({ e: "soon" }))).toBeNull();
    expect(parseInviteExpiry(token({ e: -5 }))).toBeNull();
  });

  it("returns null for junk / empty input", () => {
    expect(parseInviteExpiry("")).toBeNull();
    expect(parseInviteExpiry("not-a-token")).toBeNull();
    expect(parseInviteExpiry(undefined as unknown as string)).toBeNull();
  });
});

describe("isExpiringSoon", () => {
  const now = 1_800_000_000;
  const week = 7 * 24 * 60 * 60;

  it("is true when the expiry is within the window", () => {
    expect(isExpiringSoon(token({ e: now + 3 * 24 * 60 * 60 }), now, week)).toBe(
      true,
    );
  });

  it("is true when the code has already expired", () => {
    expect(isExpiringSoon(token({ e: now - 100 }), now, week)).toBe(true);
  });

  it("is false when the expiry is comfortably in the future", () => {
    expect(isExpiringSoon(token({ e: now + 30 * 24 * 60 * 60 }), now, week)).toBe(
      false,
    );
  });

  it("is false when the code carries no readable expiry", () => {
    expect(isExpiringSoon("v2.opaque", now, week)).toBe(false);
  });
});
