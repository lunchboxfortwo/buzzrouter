import { afterEach, describe, expect, it } from "vitest";

import {
  checkRateLimit,
  resetManagedIdentityRateLimits,
} from "./rate-limit";

afterEach(() => {
  resetManagedIdentityRateLimits();
});

describe("checkRateLimit", () => {
  it("allows up to the limit then blocks within the window", () => {
    const rule = { key: "a", limit: 2, windowMs: 60_000 };
    expect(checkRateLimit([rule], 1_000).allowed).toBe(true);
    expect(checkRateLimit([rule], 2_000).allowed).toBe(true);
    const blocked = checkRateLimit([rule], 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not record denied requests (no window pushing)", () => {
    const rule = { key: "a", limit: 1, windowMs: 60_000 };
    expect(checkRateLimit([rule], 1_000).allowed).toBe(true);
    // Hammering while blocked must not extend the window past the first entry.
    checkRateLimit([rule], 2_000);
    checkRateLimit([rule], 3_000);
    // The first entry (t=1000) frees at t=61000; a request at 61001 is allowed.
    expect(checkRateLimit([rule], 61_001).allowed).toBe(true);
  });

  it("frees a slot once the oldest entry leaves the window", () => {
    const rule = { key: "a", limit: 1, windowMs: 10_000 };
    expect(checkRateLimit([rule], 0).allowed).toBe(true);
    expect(checkRateLimit([rule], 5_000).allowed).toBe(false);
    expect(checkRateLimit([rule], 10_001).allowed).toBe(true);
  });

  it("blocks if ANY rule in the set is exhausted, without recording the others", () => {
    const perKey = { key: "pk", limit: 5, windowMs: 60_000 };
    const global = { key: "global", limit: 1, windowMs: 60_000 };
    expect(checkRateLimit([perKey, global], 1_000).allowed).toBe(true);
    // Global is now full; the next call is blocked even though perKey has room.
    expect(checkRateLimit([perKey, global], 2_000).allowed).toBe(false);
    // Because the blocked call recorded nothing, perKey still has 4 slots: after
    // global frees at 61000, a call at 61001 succeeds and perKey has only 2 uses.
    expect(checkRateLimit([perKey, global], 61_001).allowed).toBe(true);
  });

  it("isolates independent keys", () => {
    const a = { key: "a", limit: 1, windowMs: 60_000 };
    const b = { key: "b", limit: 1, windowMs: 60_000 };
    expect(checkRateLimit([a], 1_000).allowed).toBe(true);
    expect(checkRateLimit([b], 1_000).allowed).toBe(true);
    expect(checkRateLimit([a], 1_500).allowed).toBe(false);
  });
});
