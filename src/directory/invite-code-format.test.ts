import { describe, expect, it } from "vitest";

import {
  BUZZ_INVITE_CODE_SQL_RE,
  isBuzzInviteCode,
} from "./invite-code-format";

// Real codes observed in production (the artificiallyintimidating code is
// single-use and already consumed; the creatormagic one is from the public
// buzz-directory catalog).
const REAL_CODES = [
  "v2.q72X2hjMBerQOLnC76kJ4TuNJtuG_RcH2aXl0eImzqk",
  "eyJjIjoiYTczMjczNTMtYzExOS00OWNiLWE4ZjQtNTI3YzY4NmQyMDlkIiwiciI6Im1lbWJlciIsImUiOjE3ODc3NTQ4MTksIm4iOiJOYmZvWm5TSzRlUVpZc1pTSnlHVkx3In0.waEPhDSFQrfaxlxqGCuqkWFxfZiiI-9JpuGKvkI4dUk",
  // A future version bump must keep matching.
  "v3.someFutureOpaqueToken_123",
];

// The bogus "codes" that reached production: bare community names/slugs, every
// one confirmed `invite_invalid` against its relay (2026-08-03).
const BOGUS_CODES = [
  "virtualoranges",
  "eco",
  "la",
  "silverback",
  "nearbuilders",
  "Wailyn",
];

const MALFORMED = [
  "",
  "   ",
  "v2.",
  "v2.short", // fewer than 8 token chars after the prefix
  "eyJab", // fewer than 8 token chars after `eyJ`
  "v2.has spaces in it",
  "https://relay.example/invite/v2.q72X2hjMBerQOLnC76kJ4TuNJtu",
  "buzz://join?relay=wss://r.example&code=v2.q72X2hjMBerQOLnC76kJ4",
];

describe("isBuzzInviteCode", () => {
  it("accepts every real production code shape", () => {
    for (const code of REAL_CODES) {
      expect(isBuzzInviteCode(code), code).toBe(true);
    }
  });

  it("rejects the bare-name codes that reached production", () => {
    for (const code of BOGUS_CODES) {
      expect(isBuzzInviteCode(code), code).toBe(false);
    }
  });

  it("rejects malformed and embedded-in-URL values", () => {
    for (const code of MALFORMED) {
      expect(isBuzzInviteCode(code), code).toBe(false);
    }
  });
});

describe("BUZZ_INVITE_CODE_SQL_RE", () => {
  it("agrees with the RegExp on every fixture (POSIX/JS parity)", () => {
    // The POSIX ERE happens to also be a valid JS pattern with identical
    // semantics for this charset, so parity is directly assertable.
    const sqlAsJs = new RegExp(BUZZ_INVITE_CODE_SQL_RE);
    for (const code of [...REAL_CODES, ...BOGUS_CODES, ...MALFORMED]) {
      expect(sqlAsJs.test(code), code).toBe(isBuzzInviteCode(code));
    }
  });

  it("contains no single quotes (it is inlined into SQL literals)", () => {
    expect(BUZZ_INVITE_CODE_SQL_RE).not.toContain("'");
  });
});
