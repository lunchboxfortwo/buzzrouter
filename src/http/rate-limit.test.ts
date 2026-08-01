import { beforeEach, describe, expect, it } from "vitest";

import {
  checkSubmissionRateLimit,
  resetRateLimitState,
} from "./rate-limit";

const BASE = 1_700_000_000_000;

beforeEach(() => {
  resetRateLimitState();
});

describe("checkSubmissionRateLimit", () => {
  it("allows requests under the per-minute cap", () => {
    for (let i = 0; i < 5; i += 1) {
      const result = checkSubmissionRateLimit("1.1.1.1", BASE + i * 1_000);
      expect(result.allowed).toBe(true);
      expect(result.retryAfterSeconds).toBeUndefined();
    }
  });

  it("denies the 6th request in a minute with a retryAfter", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(
        checkSubmissionRateLimit("1.1.1.1", BASE + i * 1_000).allowed,
      ).toBe(true);
    }
    const sixth = checkSubmissionRateLimit("1.1.1.1", BASE + 5_000);
    expect(sixth.allowed).toBe(false);
    // First request was at BASE; it leaves the 60s window at BASE + 60_000,
    // i.e. 55s after the 6th request at BASE + 5_000.
    expect(sixth.retryAfterSeconds).toBe(55);
  });

  it("does not record denied requests against the window", () => {
    for (let i = 0; i < 5; i += 1) {
      checkSubmissionRateLimit("1.1.1.1", BASE + i * 1_000);
    }
    // Hammer while blocked; none of these should push the window forward.
    for (let i = 0; i < 10; i += 1) {
      expect(checkSubmissionRateLimit("1.1.1.1", BASE + 6_000).allowed).toBe(
        false,
      );
    }
    // Once the first request (BASE) ages out at BASE + 60_000, a slot frees.
    expect(
      checkSubmissionRateLimit("1.1.1.1", BASE + 60_000).allowed,
    ).toBe(true);
  });

  it("tracks different IPs independently", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(
        checkSubmissionRateLimit("1.1.1.1", BASE + i * 1_000).allowed,
      ).toBe(true);
    }
    expect(checkSubmissionRateLimit("1.1.1.1", BASE + 5_000).allowed).toBe(
      false,
    );
    // A different IP has its own budget.
    expect(checkSubmissionRateLimit("2.2.2.2", BASE + 5_000).allowed).toBe(
      true,
    );
  });

  it("enforces the per-hour cap even when spread under the minute cap", () => {
    // 20 requests spaced 2 minutes apart: never trips the 5/min cap, and all
    // 20 stay inside the 1h window (2 min * 19 = 38 min), so the 21st hits the
    // 20/hour cap.
    for (let i = 0; i < 20; i += 1) {
      const result = checkSubmissionRateLimit("3.3.3.3", BASE + i * 120_000);
      expect(result.allowed).toBe(true);
    }
    const twentyFirst = checkSubmissionRateLimit("3.3.3.3", BASE + 20 * 120_000);
    expect(twentyFirst.allowed).toBe(false);
    expect(twentyFirst.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("enforces the global cap across many IPs", () => {
    // 30 distinct IPs, one request each, all within the same minute.
    for (let i = 0; i < 30; i += 1) {
      const result = checkSubmissionRateLimit(`10.0.0.${i}`, BASE + i * 1_000);
      expect(result.allowed).toBe(true);
    }
    // A fresh 31st IP is under its own per-IP caps but the global 30/min is full.
    const thirtyFirst = checkSubmissionRateLimit("10.0.1.1", BASE + 30_000);
    expect(thirtyFirst.allowed).toBe(false);
    // Global window's oldest entry (BASE) frees at BASE + 60_000 = 30s later.
    expect(thirtyFirst.retryAfterSeconds).toBe(30);
  });

  it("frees per-IP capacity once the window advances", () => {
    for (let i = 0; i < 5; i += 1) {
      checkSubmissionRateLimit("4.4.4.4", BASE + i * 1_000);
    }
    expect(checkSubmissionRateLimit("4.4.4.4", BASE + 5_000).allowed).toBe(
      false,
    );
    // Move past the first request's 60s window so a slot reopens.
    expect(
      checkSubmissionRateLimit("4.4.4.4", BASE + 60_001).allowed,
    ).toBe(true);
  });

  it("frees global capacity once the window advances", () => {
    for (let i = 0; i < 30; i += 1) {
      checkSubmissionRateLimit(`11.0.0.${i}`, BASE + i * 1_000);
    }
    expect(checkSubmissionRateLimit("11.0.1.1", BASE + 29_000).allowed).toBe(
      false,
    );
    // After the oldest global entry (BASE) ages out, room reopens globally.
    expect(
      checkSubmissionRateLimit("11.0.1.1", BASE + 60_001).allowed,
    ).toBe(true);
  });
});
