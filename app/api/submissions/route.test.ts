import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimitState } from "../../../src/http/rate-limit";
import { POST } from "./route";

/** A same-origin POST with an explicit client IP and content-type. */
function post(
  body: string,
  { ip = "1.2.3.4", contentType = "application/x-www-form-urlencoded" } = {},
): Request {
  return new Request("https://buzzrouter.com/api/submissions", {
    body,
    headers: {
      "cf-connecting-ip": ip,
      "content-type": contentType,
      origin: "https://buzzrouter.com",
    },
    method: "POST",
  });
}

describe("community submissions", () => {
  beforeEach(() => {
    resetRateLimitState();
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimitState();
  });

  it("rejects cross-origin form posts before reading the body", async () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    const response = await POST(
      new Request("https://buzzrouter.com/api/submissions", {
        body: "relayUrl=wss%3A%2F%2Fbuilders.example",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://attacker.example",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://buzzrouter.com/submit?status=invalid",
    );
  });

  it("bounds streamed form bodies even without content-length", async () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    const response = await POST(
      new Request("https://buzzrouter.com/api/submissions", {
        body: `relayUrl=${"a".repeat(5_000)}`,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://buzzrouter.com",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://buzzrouter.com/submit?status=invalid",
    );
  });

  it("rate-limits an IP after the per-minute allowance", async () => {
    // A wrong content-type fails fast (after the rate-limit check, before any DB
    // work), so five of these are recorded, then the sixth is throttled.
    for (let i = 0; i < 5; i += 1) {
      const res = await POST(post("x=1", { contentType: "text/plain" }));
      expect(res.headers.get("location")).toBe(
        "https://buzzrouter.com/submit?status=invalid",
      );
    }
    const throttled = await POST(post("x=1", { contentType: "text/plain" }));
    expect(throttled.headers.get("location")).toBe(
      "https://buzzrouter.com/submit?status=rate_limited",
    );
    // A different IP is unaffected.
    const other = await POST(
      post("x=1", { contentType: "text/plain", ip: "9.9.9.9" }),
    );
    expect(other.headers.get("location")).toBe(
      "https://buzzrouter.com/submit?status=invalid",
    );
  });

  it("rejects a submission missing a contact email", async () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    const response = await POST(
      new Request("https://buzzrouter.com/api/submissions", {
        body: "relayUrl=wss%3A%2F%2Fno-email-test.example",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://buzzrouter.com",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://buzzrouter.com/submit?status=invalid",
    );
  });

  it("rejects a submission with a malformed contact email", async () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    const response = await POST(
      new Request("https://buzzrouter.com/api/submissions", {
        body: "relayUrl=wss%3A%2F%2Fbad-email-test.example&contactEmail=not-an-email",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://buzzrouter.com",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://buzzrouter.com/submit?status=invalid",
    );
  });

  it("rejects a submission with an unrecognized focus", async () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    const response = await POST(
      new Request("https://buzzrouter.com/api/submissions", {
        body:
          "relayUrl=wss%3A%2F%2Fbad-focus-test.example" +
          "&contactEmail=owner%40bad-focus-test.example" +
          "&focus=not-a-focus",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://buzzrouter.com",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://buzzrouter.com/submit?status=invalid",
    );
  });
});
