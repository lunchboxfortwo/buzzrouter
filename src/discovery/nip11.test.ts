import { describe, expect, it } from "vitest";

import {
  hashPublicIcon,
  parseNip11Document,
  parsePublicIconDataUri,
  parseUploadedIcon,
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

describe("parseUploadedIcon", () => {
  const pngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("test"),
  ]);

  it("accepts bytes whose magic number matches the declared type", () => {
    expect(parseUploadedIcon(pngBytes, "image/png")).toEqual({
      bytes: pngBytes,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      contentType: "image/png",
    });
  });

  it("is case-insensitive and trims the declared content type", () => {
    expect(parseUploadedIcon(pngBytes, "  IMAGE/PNG  ")).not.toBeNull();
  });

  it("rejects a content type outside the image allowlist", () => {
    expect(parseUploadedIcon(pngBytes, "image/svg+xml")).toBeNull();
    expect(parseUploadedIcon(pngBytes, "text/html")).toBeNull();
  });

  it("rejects bytes that don't match the declared type", () => {
    expect(
      parseUploadedIcon(Buffer.from("this is not a png"), "image/png"),
    ).toBeNull();
  });

  it("rejects empty and oversized uploads", () => {
    expect(parseUploadedIcon(Buffer.alloc(0), "image/png")).toBeNull();
    expect(
      parseUploadedIcon(Buffer.alloc(256 * 1024 + 1, 0x89), "image/png"),
    ).toBeNull();
  });
});
