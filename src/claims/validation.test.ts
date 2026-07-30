import { describe, expect, it } from "vitest";

import {
  parseClaimMethod,
  parseListingMetadata,
} from "./validation";

describe("parseClaimMethod", () => {
  it("accepts supported proof methods", () => {
    expect(parseClaimMethod("dns_txt")).toBe("dns_txt");
    expect(parseClaimMethod("http_file")).toBe("http_file");
    expect(parseClaimMethod("hosted_icon")).toBe("hosted_icon");
  });
});

describe("parseListingMetadata", () => {
  it("normalizes a complete public listing", () => {
    expect(
      parseListingMetadata({
        categories: ["research", "ai-agents", "research"],
        description: "A public research community.",
        displayName: "Research Guild",
        joinMode: "request_invite",
        joinUrl: "https://example.com/join",
        slug: "research-guild",
        visibility: "public",
      }),
    ).toEqual({
      categories: ["research", "ai-agents"],
      description: "A public research community.",
      displayName: "Research Guild",
      joinMode: "request_invite",
      joinUrl: "https://example.com/join",
      slug: "research-guild",
      visibility: "public",
    });
  });

  it("rejects credentials, malformed categories, and hidden invite URLs", () => {
    expect(() =>
      parseListingMetadata({
        categories: ["Research"],
        description: "Description",
        displayName: "Name",
        joinMode: "public_link",
        joinUrl: "https://user:secret@example.com",
        slug: "valid-slug",
        visibility: "public",
      }),
    ).toThrow("invalid");
    expect(() =>
      parseListingMetadata({
        categories: [],
        description: "Description",
        displayName: "Name",
        joinMode: "invite_required",
        joinUrl: "https://example.com/invite/private",
        slug: "valid-slug",
        visibility: "public",
      }),
    ).toThrow("invalid");
  });
});
