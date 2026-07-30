import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("community submissions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
});
