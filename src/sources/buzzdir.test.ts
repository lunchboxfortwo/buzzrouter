import { describe, expect, it } from "vitest";

import { parseBuzzdirCatalog } from "./buzzdir";

describe("parseBuzzdirCatalog", () => {
  it("reads only bounded literal catalog fields", () => {
    const source = `
      export const communities = [
        {
          name: "Builders",
          description: "People building on Buzz.",
          category: "Builders",
          relay: "wss://builders.communities.buzz.xyz",
          inviteUrl: "https://builders.communities.buzz.xyz/invite/secret"
        }
      ] as const;
    `;

    expect(parseBuzzdirCatalog(source)).toEqual([
      {
        category: "builders",
        description: "People building on Buzz.",
        name: "Builders",
        relay: "wss://builders.communities.buzz.xyz",
      },
    ]);
  });

  it("does not execute or accept computed catalog values", () => {
    const source = `
      const relay = "wss://builders.communities.buzz.xyz";
      export const communities = [{
        name: "Builders",
        description: "People building on Buzz.",
        category: "Builders",
        relay
      }];
    `;

    expect(() => parseBuzzdirCatalog(source)).toThrow("missing relay");
  });

  it("rejects duplicate relay records", () => {
    const source = `
      export const communities = [
        {
          name: "Builders",
          description: "One",
          category: "Builders",
          relay: "wss://builders.communities.buzz.xyz"
        },
        {
          name: "Builders Two",
          description: "Two",
          category: "Builders",
          relay: "wss://builders.communities.buzz.xyz"
        }
      ];
    `;

    expect(() => parseBuzzdirCatalog(source)).toThrow("duplicate relays");
  });
});
