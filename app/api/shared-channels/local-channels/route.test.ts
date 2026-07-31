import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/shared-channels/local-channels", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an unauthenticated request before touching the database", async () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    vi.stubEnv("DATABASE_URL", "postgres://localhost/unused");

    const response = await GET(
      new Request(
        "https://buzzrouter.com/api/shared-channels/local-channels?communityId=00000000-0000-4000-8000-000000000000",
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: "authentication_required",
    });
  });
});
