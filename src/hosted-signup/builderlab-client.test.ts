import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BuilderlabClient,
  assertCommunityName,
  resolveLiveBuilderlabConfig,
  type BuilderlabClientConfig,
} from "./builderlab-client";

const BASE_URL = "https://fake.builderlab.test/api/goose";
const ORIGIN = "https://fake.builderlab.test";

function client(
  respond: (path: string) => { status?: number; json: unknown },
): BuilderlabClient {
  const config: BuilderlabClientConfig = {
    baseUrl: BASE_URL,
    fetch: (async (url: string) => {
      const { status = 200, json } = respond(url.slice(BASE_URL.length));
      return new Response(JSON.stringify(json), {
        headers: { "content-type": "application/json" },
        status,
      });
    }) as unknown as typeof fetch,
    now: () => Date.parse("2026-07-31T21:50:00.000Z"),
    origin: ORIGIN,
  };
  return new BuilderlabClient(config);
}

describe("exchangeLoginCode", () => {
  it("exchanges an OAuth code for a session credential", async () => {
    const session = await client((path) => {
      expect(path).toBe("/v1/auth/login/exchange");
      return {
        json: {
          expires_at: "2026-08-01T05:50:00.000Z",
          session_credential: "c".repeat(43),
        },
      };
    }).exchangeLoginCode("oauth-code");

    expect(session.sessionCredential).toBe("c".repeat(43));
    expect(session.expiresAt).toBe("2026-08-01T05:50:00.000Z");
  });

  it("rejects an empty code before any network call", async () => {
    const fetchSpy = vi.fn();
    const c = new BuilderlabClient({
      baseUrl: BASE_URL,
      fetch: fetchSpy as unknown as typeof fetch,
      now: () => 0,
      origin: ORIGIN,
    });
    await expect(c.exchangeLoginCode("")).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("resolveLiveBuilderlabConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses live calls unless the opt-in flag is set", () => {
    vi.stubEnv("BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE", "");
    expect(() => resolveLiveBuilderlabConfig()).toThrowError(
      /hosted_signup_live_disabled|disabled/,
    );
  });

  it("wires the real defaults when explicitly opted in", () => {
    vi.stubEnv("BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE", "1");
    const config = resolveLiveBuilderlabConfig({ fetch: (() => {}) as never });
    expect(config.baseUrl).toBe("https://app.builderlab.xyz/api/goose");
    expect(config.origin).toBe("https://app.builderlab.xyz");
  });
});

describe("assertCommunityName", () => {
  it("accepts lowercase dash-joined names", () => {
    expect(() => assertCommunityName("my-cool-community")).not.toThrow();
  });

  it.each(["Bad", "trailing-", "-lead", "under_score", "", "a".repeat(64)])(
    "rejects %j",
    (name) => {
      expect(() => assertCommunityName(name)).toThrowError(
        /invalid_community_name|lowercase/,
      );
    },
  );
});
