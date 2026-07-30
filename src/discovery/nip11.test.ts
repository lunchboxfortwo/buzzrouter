import { describe, expect, it } from "vitest";

import { hashPublicIcon, parseNip11Document } from "./nip11";

describe("parseNip11Document", () => {
  it("extracts only bounded classifier metadata", () => {
    expect(
      parseNip11Document({
        name: "Buzz Relay",
        description: "Private relay",
        software: "https://github.com/block/buzz",
        version: "1.2.3",
        supported_nips: [1, 29, 42],
        self: "pubkey",
        limitation: {
          auth_required: true,
          restricted_writes: true,
          ignored: "value",
        },
        ignored: { nested: "data" },
      }),
    ).toEqual({
      name: "Buzz Relay",
      description: "Private relay",
      icon: undefined,
      software: "https://github.com/block/buzz",
      version: "1.2.3",
      supportedNips: [1, 29, 42],
      relaySelfPubkey: "pubkey",
      limitation: {
        authRequired: true,
        restrictedWrites: true,
      },
    });
  });

  it("rejects malformed supported NIPs", () => {
    expect(() =>
      parseNip11Document({ supported_nips: [29, "42"] }),
    ).toThrowError(expect.objectContaining({ code: "invalid_nip11" }));
  });

  it("hashes public icons rather than retaining large data URLs", () => {
    expect(hashPublicIcon("data:image/png;base64,private")).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});
