import { describe, expect, it } from "vitest";

import {
  hashPublicIcon,
  parseNip11Document,
  parsePublicIconDataUri,
} from "./nip11";

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

  it("accepts bounded raster data URLs for first-party icon serving", () => {
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("test"),
    ]);

    expect(
      parsePublicIconDataUri(
        `data:image/png;base64,${bytes.toString("base64")}`,
      ),
    ).toEqual({
      bytes,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      contentType: "image/png",
    });
  });

  it("rejects active, remote, spoofed, and oversized icon content", () => {
    expect(
      parsePublicIconDataUri(
        "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+",
      ),
    ).toBeNull();
    expect(
      parsePublicIconDataUri("https://tracker.example/icon.png"),
    ).toBeNull();
    expect(
      parsePublicIconDataUri(
        `data:image/png;base64,${Buffer.from("not a png").toString("base64")}`,
      ),
    ).toBeNull();
    expect(
      parsePublicIconDataUri(
        `data:image/png;base64,${Buffer.alloc(256 * 1024 + 1).toString("base64")}`,
      ),
    ).toBeNull();
  });
});
