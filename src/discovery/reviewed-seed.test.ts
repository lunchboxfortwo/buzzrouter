import { describe, expect, it } from "vitest";

import {
  addReviewedRelay,
  parseReviewedRelaySeed,
  serializeReviewedRelaySeed,
} from "./reviewed-seed";

describe("reviewed relay seed", () => {
  it("canonicalizes candidate and evidence URLs before persistence", () => {
    const seed = addReviewedRelay(
      { relays: [] },
      "https://Relay.Example.com/invite/private?code=secret",
      "https://github.com/example/project?tab=readme#source",
    );

    expect(seed).toEqual({
      relays: [
        {
          url: "wss://relay.example.com",
          sourceLocator: "https://github.com/example/project",
        },
      ],
    });
    expect(JSON.stringify(seed)).not.toContain("private");
    expect(JSON.stringify(seed)).not.toContain("secret");
  });

  it("deduplicates the same canonical relay and source", () => {
    const first = addReviewedRelay(
      { relays: [] },
      "wss://relay.example.com",
      "https://github.com/example/project",
    );
    const second = addReviewedRelay(
      first,
      "https://relay.example.com/path",
      "https://github.com/example/project#fragment",
    );

    expect(second.relays).toHaveLength(1);
  });

  it("retains independent public evidence for one relay", () => {
    const first = addReviewedRelay(
      { relays: [] },
      "wss://relay.example.com",
      "https://github.com/example/project",
    );
    const second = addReviewedRelay(
      first,
      "wss://relay.example.com",
      "https://github.com/example/other",
    );

    expect(second.relays).toHaveLength(2);
  });

  it("normalizes existing entries when loading the file", () => {
    expect(
      parseReviewedRelaySeed(
        JSON.stringify({
          relays: [
            {
              url: "https://Relay.Example.com/invite/code",
              sourceLocator:
                "https://github.com/example/project?query=removed",
            },
          ],
        }),
      ),
    ).toEqual({
      relays: [
        {
          url: "wss://relay.example.com",
          sourceLocator: "https://github.com/example/project",
        },
      ],
    });
  });

  it("serializes with a final newline", () => {
    expect(serializeReviewedRelaySeed({ relays: [] })).toBe(
      '{\n  "relays": []\n}\n',
    );
  });
});
