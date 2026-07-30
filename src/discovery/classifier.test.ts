import { describe, expect, it } from "vitest";

import {
  BUZZ_CLASSIFIER_VERSION,
  classifyBuzzRelay,
} from "./classifier";
import type { Nip11Document } from "./nip11";

const baseDocument: Nip11Document = {
  name: "Buzz Relay",
  software: "https://github.com/block/buzz",
  supportedNips: [1, 11, 29, 42],
  limitation: {
    authRequired: true,
    restrictedWrites: true,
  },
};

describe("classifyBuzzRelay", () => {
  it("verifies only the canonical Buzz software and required NIPs", () => {
    expect(classifyBuzzRelay(baseDocument, true)).toEqual({
      state: "verified_buzz",
      reason: "exact_software_and_protocol",
      classifierVersion: BUZZ_CLASSIFIER_VERSION,
    });
  });

  it("accepts a trailing slash on the canonical software URL", () => {
    expect(
      classifyBuzzRelay(
        { ...baseDocument, software: "https://github.com/block/buzz/" },
        true,
      ).state,
    ).toBe("verified_buzz");
  });

  it("quarantines probable Buzz metadata when software is absent", () => {
    expect(
      classifyBuzzRelay({ ...baseDocument, software: undefined }, true),
    ).toEqual({
      state: "probable_buzz",
      reason: "buzz_metadata_without_canonical_software",
      classifierVersion: BUZZ_CLASSIFIER_VERSION,
    });
  });

  it("rejects another relay implementation even if the name is copied", () => {
    expect(
      classifyBuzzRelay(
        {
          ...baseDocument,
          software: "https://github.com/example/other-relay",
        },
        true,
      ),
    ).toMatchObject({
      state: "rejected",
      reason: "different_software",
    });
  });

  it.each([
    "https://user:secret@github.com/block/buzz",
    "https://github.com/block/buzz?variant=other",
    "https://github.com/block/buzz#fork",
    "http://github.com/block/buzz",
  ])("rejects noncanonical software metadata %s", (software) => {
    expect(
      classifyBuzzRelay({ ...baseDocument, software }, true),
    ).toMatchObject({
      state: "rejected",
      reason: "different_software",
    });
  });

  it("rejects missing protocol support", () => {
    expect(
      classifyBuzzRelay({ ...baseDocument, supportedNips: [29] }, true),
    ).toMatchObject({
      state: "rejected",
      reason: "insufficient_buzz_evidence",
    });
  });

  it("rejects an unavailable WebSocket regardless of metadata", () => {
    expect(classifyBuzzRelay(baseDocument, false)).toMatchObject({
      state: "rejected",
      reason: "websocket_unavailable",
    });
  });
});
