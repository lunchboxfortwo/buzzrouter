import { describe, expect, it } from "vitest";

import { normalizeRelayUrl } from "../discovery/normalize";
import {
  extractRelayUrls,
  hasReachedGitHubQueryEnd,
  sanitizeGitHubCursor,
} from "./github";

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
        "BUZZ_RELAY_URL=wss://relay.example.net docs=https://github.com/block/buzz",
      ),
    ).toEqual(["wss://relay.example.net"]);
  });

  it("trims punctuation around source-language literals", () => {
    expect(
      extractRelayUrls(
        "const relay = new URL('wss://relay.example.net/path');",
      ),
    ).toEqual(["wss://relay.example.net/path"]);
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
