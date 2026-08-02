import { describe, expect, it } from "vitest";

import { normalizeRelayUrl } from "../discovery/normalize";
import {
  createGitHubSearchClient,
  extractInviteCode,
  extractRelayUrls,
  fetchGitHubSourceText,
  githubBlobToRawUrl,
  hasReachedGitHubQueryEnd,
  isHarvestableInviteCode,
  isIgnoredGitHubHost,
  parseGitHubCodeSearchResponse,
  sanitizeGitHubCursor,
} from "./github";

describe("createGitHubSearchClient", () => {
  it("accepts a credential proxy base URL", () => {
    expect(() =>
      createGitHubSearchClient(
        "proxy-token",
        "https://credential-proxy.example/v1/egress/grant",
      ),
    ).not.toThrow();
  });
});

describe("githubBlobToRawUrl", () => {
  it("rewrites a GitHub blob URL onto the raw-content origin", () => {
    expect(
      githubBlobToRawUrl(
        "https://github.com/acme/community/blob/main/config/relay.env",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/acme/community/main/config/relay.env",
    );
  });

  it("rejects non-GitHub, credentialed, and non-blob URLs", () => {
    expect(
      githubBlobToRawUrl("https://attacker.example/a/b/blob/main/x"),
    ).toBeNull();
    expect(
      githubBlobToRawUrl(
        "https://user:secret@github.com/a/b/blob/main/x",
      ),
    ).toBeNull();
    expect(
      githubBlobToRawUrl("https://github.com/a/b/issues/1"),
    ).toBeNull();
    expect(
      githubBlobToRawUrl("http://github.com/a/b/blob/main/x"),
    ).toBeNull();
    expect(
      githubBlobToRawUrl("https://github.com:8443/a/b/blob/main/x"),
    ).toBeNull();
    expect(
      githubBlobToRawUrl("https://github.com/a/b/blob/bad%20ref/x"),
    ).toBeNull();
  });
});

describe("fetchGitHubSourceText", () => {
  it("fetches only the derived raw URL", async () => {
    let requested = "";
    const fetchImpl: typeof fetch = async (input) => {
      requested = String(input);
      return new Response("BUZZ_RELAY_URL=wss://relay.example");
    };
    await expect(
      fetchGitHubSourceText(
        "https://github.com/acme/community/blob/main/.env.example",
        fetchImpl,
      ),
    ).resolves.toContain("relay.example");
    expect(requested).toBe(
      "https://raw.githubusercontent.com/acme/community/main/.env.example",
    );
  });

  it("rejects a response beyond the source-size ceiling", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("x", { headers: { "content-length": "1000001" } });
    await expect(
      fetchGitHubSourceText(
        "https://github.com/acme/community/blob/main/huge.txt",
        fetchImpl,
      ),
    ).rejects.toThrow("size limit");
  });

  it("stops a streamed response that crosses the source-size ceiling", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(600_000));
            controller.enqueue(new Uint8Array(600_000));
            controller.close();
          },
        }),
      );
    await expect(
      fetchGitHubSourceText(
        "https://github.com/acme/community/blob/main/stream.txt",
        fetchImpl,
      ),
    ).rejects.toThrow("size limit");
  });

  it("rejects invalid source URLs and non-success responses", async () => {
    await expect(
      fetchGitHubSourceText("https://attacker.example/source"),
    ).rejects.toThrow("supported blob URL");
    const fetchImpl: typeof fetch = async () =>
      new Response("missing", { status: 404 });
    await expect(
      fetchGitHubSourceText(
        "https://github.com/acme/community/blob/main/missing.txt",
        fetchImpl,
      ),
    ).rejects.toThrow("HTTP 404");
  });

  it("accepts an empty successful response", async () => {
    const fetchImpl: typeof fetch = async () => new Response(null);
    await expect(
      fetchGitHubSourceText(
        "https://github.com/acme/community/blob/main/empty.txt",
        fetchImpl,
      ),
    ).resolves.toBe("");
  });
});

describe("extractInviteCode", () => {
  const v2 = "v2.umQGOlbNHvzs5fDVgxWCcU1N6ZmKr_3QAqPiuM4AgV4";
  const legacy = `${Buffer.from(
    JSON.stringify({ e: 1_900_000_000 }),
    "utf8",
  ).toString("base64url")}.signature123`;

  it("extracts an absolute invite whose host matches the candidate", () => {
    expect(
      extractInviteCode(
        `Join https://alpha.communities.buzz.xyz/invite/${v2}`,
        "wss://alpha.communities.buzz.xyz",
      ),
    ).toBe(v2);
  });

  it("extracts relative and bare supported codes near the relay", () => {
    expect(
      extractInviteCode(
        `BUZZ_RELAY_URL=wss://alpha.communities.buzz.xyz\nBUZZ_INVITE=/invite/${legacy}`,
        "wss://alpha.communities.buzz.xyz",
      ),
    ).toBe(legacy);
    expect(
      extractInviteCode(
        `relay=https://alpha.communities.buzz.xyz\ninvite=${v2}`,
        "wss://alpha.communities.buzz.xyz",
      ),
    ).toBe(v2);
  });

  it("stores a structurally valid legacy code even with an old expiry", () => {
    const expired = `${Buffer.from(
      JSON.stringify({ e: 1 }),
      "utf8",
    ).toString("base64url")}.signature123`;
    expect(
      extractInviteCode(
        `wss://alpha.communities.buzz.xyz /invite/${expired}`,
        "wss://alpha.communities.buzz.xyz",
      ),
    ).toBe(expired);
  });

  it("never carries another community's invite onto the candidate", () => {
    const text = [
      "relay=wss://alpha.communities.buzz.xyz",
      `invite=${legacy}`,
      "relay=wss://gamma.communities.buzz.xyz",
      `invite=${v2}`,
    ].join("\n");
    expect(
      extractInviteCode(text, "wss://alpha.communities.buzz.xyz"),
    ).toBe(legacy);
    expect(
      extractInviteCode(text, "wss://gamma.communities.buzz.xyz"),
    ).toBe(v2);
    expect(
      extractInviteCode(
        `https://gamma.communities.buzz.xyz/invite/${v2}`,
        "wss://alpha.communities.buzz.xyz",
      ),
    ).toBeNull();
  });

  it("requires the relay port to match as part of the host", () => {
    expect(
      extractInviteCode(
        `https://relay.service.net:8443/invite/${v2}`,
        "wss://relay.service.net:443",
      ),
    ).toBeNull();
  });

  it("rejects codes outside the bounded relay neighborhood", () => {
    expect(
      extractInviteCode(
        `wss://alpha.communities.buzz.xyz ${"x".repeat(513)} ${v2}`,
        "wss://alpha.communities.buzz.xyz",
      ),
    ).toBeNull();
    expect(extractInviteCode(v2, "not a relay URL")).toBeNull();
  });

  it("rejects junk and non-expiry-bearing legacy-looking codes", () => {
    expect(
      extractInviteCode(
        "wss://alpha.communities.buzz.xyz /invite/not-a-real-code",
        "wss://alpha.communities.buzz.xyz",
      ),
    ).toBeNull();
    const opaqueLegacy = `${Buffer.from(
      JSON.stringify({ role: "member" }),
    ).toString("base64url")}.signature123`;
    expect(
      extractInviteCode(
        `wss://alpha.communities.buzz.xyz /invite/${opaqueLegacy}`,
        "wss://alpha.communities.buzz.xyz",
      ),
    ).toBeNull();
    const negativeExpiry = `${Buffer.from(
      JSON.stringify({ e: -1 }),
    ).toString("base64url")}.signature123`;
    expect(isHarvestableInviteCode(negativeExpiry)).toBe(false);
    expect(isHarvestableInviteCode(`v2.${"a".repeat(197)}`)).toBe(false);
  });
});

describe("parseGitHubCodeSearchResponse", () => {
  it("parses JSON text returned by a credential proxy", () => {
    expect(
      parseGitHubCodeSearchResponse(
        JSON.stringify({
          incomplete_results: false,
          items: [],
          total_count: 0,
        }),
      ),
    ).toEqual({
      incomplete_results: false,
      items: [],
      total_count: 0,
    });
  });
});

describe("extractRelayUrls", () => {
  it("extracts a complete URL before ingestion redacts the invite path", () => {
    const extracted = extractRelayUrls(
      'BUZZ_RELAY_URL="https://alpha.communities.buzz.xyz/invite/secret?code=private"',
    );

    expect(extracted).toEqual([
      "https://alpha.communities.buzz.xyz/invite/secret?code=private",
    ]);
    expect(normalizeRelayUrl(extracted[0])).toMatchObject({
      canonicalRelayUrl: "wss://alpha.communities.buzz.xyz",
      host: "alpha.communities.buzz.xyz",
    });
  });

  it("accepts WebSocket relay configuration and ignores code hosts", () => {
    expect(
      extractRelayUrls(
        "BUZZ_RELAY_URL=wss://relay.service.net docs=https://github.com/block/buzz",
      ),
    ).toEqual(["wss://relay.service.net"]);
  });

  it("trims punctuation around source-language literals", () => {
    expect(
      extractRelayUrls(
        "const relay = new URL('wss://relay.service.net/path');",
      ),
    ).toEqual(["wss://relay.service.net/path"]);
  });

  it("rejects documentation placeholders before ingestion", () => {
    expect(
      extractRelayUrls(
        [
          "https://mycommunity.communities.buzz.xyz",
          "https://beta.communities.buzz.xyz",
          "https://north-star.communities.buzz.xyz",
          "wss://buzz.example.com",
          "wss://real-team.communities.buzz.xyz",
        ].join(" "),
      ),
    ).toEqual(["wss://real-team.communities.buzz.xyz"]);
  });
});

describe("isIgnoredGitHubHost", () => {
  it("does not reject a specific Buzz tenant", () => {
    expect(
      isIgnoredGitHubHost("builders.communities.buzz.xyz"),
    ).toBe(false);
  });
});

describe("sanitizeGitHubCursor", () => {
  it("keeps a bounded cursor", () => {
    expect(
      sanitizeGitHubCursor({ queryIndex: 1, page: 4 }, 2),
    ).toEqual({ queryIndex: 1, page: 4 });
  });

  it("recovers invalid and completed cursors", () => {
    expect(
      sanitizeGitHubCursor({ queryIndex: 2, page: 1 }, 2),
    ).toEqual({ queryIndex: 0, page: 1 });
    expect(
      sanitizeGitHubCursor({ queryIndex: 0, page: 11 }, 2),
    ).toEqual({ queryIndex: 0, page: 1 });
  });
});

describe("hasReachedGitHubQueryEnd", () => {
  it("finishes a broad query at GitHub's 1,000-result boundary", () => {
    expect(
      hasReachedGitHubQueryEnd(
        {
          incomplete: false,
          items: Array.from({ length: 100 }, (_, index) => ({
            evidenceId: String(index),
            fragments: [],
            htmlUrl: `https://github.com/example/repo/${index}`,
          })),
          totalCount: 5_000,
        },
        10,
      ),
    ).toBe(true);
  });
});
