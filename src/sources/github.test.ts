import { describe, expect, it } from "vitest";

import { normalizeRelayUrl } from "../discovery/normalize";
import {
  createGitHubSearchClient,
  extractRelayUrls,
  hasReachedGitHubQueryEnd,
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
