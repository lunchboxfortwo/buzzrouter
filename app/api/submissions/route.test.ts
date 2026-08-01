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

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function validPng(extraBytes = 16): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(extraBytes, 1)]);
}

function multipartRequest(
  fields: Record<string, string>,
  logo?: { bytes: Buffer; name?: string; type: string },
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  if (logo) {
    form.set(
      "logo",
      new File([Uint8Array.from(logo.bytes)], logo.name ?? "logo.png", {
        type: logo.type,
      }),
    );
  }
  return new Request("https://buzzrouter.com/api/submissions", {
    body: form,
    headers: { origin: "https://buzzrouter.com" },
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

  describe("logo upload", () => {
    const fields = {
      contactEmail: "owner@logo-test.example",
      relayUrl: "wss://logo-test.example",
    };

    it("rejects a logo with a disallowed content type", async () => {
      vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
      const response = await POST(
        multipartRequest(fields, {
          bytes: Buffer.from("<svg onload=alert(1)></svg>"),
          name: "logo.svg",
          type: "image/svg+xml",
        }),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://buzzrouter.com/submit?status=invalid",
      );
    });

    it("rejects an oversize logo", async () => {
      vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
      const response = await POST(
        multipartRequest(fields, {
          bytes: validPng(300 * 1024),
          type: "image/png",
        }),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://buzzrouter.com/submit?status=invalid",
      );
    });

    it("rejects a logo whose bytes don't match the declared content type", async () => {
      vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
      const response = await POST(
        multipartRequest(fields, {
          // Declares PNG but the bytes are plain text, not a real PNG.
          bytes: Buffer.from("this is not an image"),
          type: "image/png",
        }),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://buzzrouter.com/submit?status=invalid",
      );
    });
  });
});
