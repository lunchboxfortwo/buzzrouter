import { describe, expect, it } from "vitest";

import { classifyFocus } from "./classify-focus";

const GENERIC = "Buzz — private team communication relay";

describe("classifyFocus", () => {
  it.each([
    ["builders", "building"],
    ["bitcoin", "bitcoin-money"],
    ["culture", "design-creative"],
    ["gtm", "growth-gtm"],
    ["labs", "research-knowledge"],
    ["privacy", "privacy-security"],
  ])("maps the catalog's own %s tag", (tag, expected) => {
    expect(
      classifyFocus({
        catalogCategories: [tag],
        description: GENERIC,
        host: "opaque.example",
      })?.focus,
    ).toBe(expected);
  });

  it("lets a declared catalog tag outrank hostname keywords", () => {
    expect(
      classifyFocus({
        catalogCategories: ["privacy"],
        description: GENERIC,
        host: "bitcoiners.example",
      })?.focus,
    ).toBe("privacy-security");
  });

  it("falls back to keywords when the catalog tag is unknown", () => {
    expect(
      classifyFocus({
        catalogCategories: ["something-else"],
        description: GENERIC,
        host: "bitcoiners.example",
      })?.focus,
    ).toBe("bitcoin-money");
  });

  it.each([
    ["bitcoiners.communities.buzz.xyz", "bitcoin-money"],
    ["cashu.communities.buzz.xyz", "bitcoin-money"],
    ["fintech-open-source.communities.buzz.xyz", "bitcoin-money"],
    ["designers.communities.buzz.xyz", "design-creative"],
    ["creatormagic.communities.buzz.xyz", "design-creative"],
    ["audiodev.communities.buzz.xyz", "design-creative"],
    ["vim-jp.communities.buzz.xyz", "building"],
    ["galicia.communities.buzz.xyz", "local-regional"],
  ])("classifies %s from the hostname alone", (host, expected) => {
    expect(classifyFocus({ description: GENERIC, host })?.focus).toBe(expected);
  });

  it.each([
    "millers.communities.buzz.xyz",
    "flint.communities.buzz.xyz",
    "yc2897.communities.buzz.xyz",
    "vcmc.communities.buzz.xyz",
    "bba.communities.buzz.xyz",
  ])("leaves opaque host %s unclassified", (host) => {
    expect(classifyFocus({ description: GENERIC, host })).toBeNull();
  });

  it("ignores the generic description every relay publishes", () => {
    expect(
      classifyFocus({ description: GENERIC, host: "opaque.example" }),
    ).toBeNull();
  });

  it("uses a real description when the relay wrote one", () => {
    expect(
      classifyFocus({
        description: "A room for bitcoin and lightning payments.",
        host: "opaque.example",
      })?.focus,
    ).toBe("bitcoin-money");
  });

  it("treats a genuinely ambiguous name as unclassified", () => {
    // "devin" pulls toward agents and "builders" toward building at equal
    // weight; guessing between them would be worse than leaving it for review.
    expect(
      classifyFocus({ description: GENERIC, host: "devin-builders.example" }),
    ).toBeNull();
  });

  it("lets the hostname outweigh borrowed code references", () => {
    const result = classifyFocus({
      description: GENERIC,
      githubLocators: ["https://github.com/acme/design-system/blob/main/README.md"],
      host: "bitcoiners.example",
    });

    expect(result?.focus).toBe("bitcoin-money");
  });

  it("falls back to code references when the name says nothing", () => {
    const result = classifyFocus({
      description: GENERIC,
      githubLocators: ["https://github.com/acme/research-papers/blob/main/relays.md"],
      host: "opaque.example",
    });

    expect(result?.focus).toBe("research-knowledge");
  });

  it("reports which words drove the match", () => {
    expect(
      classifyFocus({ description: GENERIC, host: "bitcoiners.example" })?.matched,
    ).toContain("bitcoin");
  });
});
