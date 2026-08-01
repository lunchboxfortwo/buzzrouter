import { describe, expect, it, vi } from "vitest";

import { SourceAdapterError } from "./errors";
import {
  createXSearchClient,
  postTextForExtraction,
  type XSearchPost,
} from "./x-search";

describe("postTextForExtraction", () => {
  it("returns bare text when there are no expanded URLs", () => {
    const post: XSearchPost = {
      expandedUrls: [],
      id: "1",
      text: "hello",
    };
    expect(postTextForExtraction(post)).toBe("hello");
  });

  it("appends expanded URLs so invite paths survive t.co shortening", () => {
    const post: XSearchPost = {
      expandedUrls: [
        "https://creatormagic.communities.buzz.xyz/invite/CODE1",
      ],
      id: "1",
      text: "join us https://t.co/abc",
    };
    expect(postTextForExtraction(post)).toContain(
      "https://creatormagic.communities.buzz.xyz/invite/CODE1",
    );
  });
});

describe("createXSearchClient", () => {
  it("rejects an empty bearer token", () => {
    expect(() => createXSearchClient("  ")).toThrow(SourceAdapterError);
  });

  it("parses posts and expanded URL entities from a successful response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              created_at: "2026-07-30T17:01:14.000Z",
              entities: {
                urls: [
                  {
                    expanded_url:
                      "https://hermesagent.communities.buzz.xyz/invite/v2.abc",
                    url: "https://t.co/xyz",
                  },
                ],
              },
              id: "2082511782912897158",
              text: "Unofficial Hermes invite https://t.co/xyz",
            },
          ],
          meta: {
            newest_id: "2082511782912897158",
            oldest_id: "2082511782912897158",
            result_count: 1,
          },
        }),
        { status: 200 },
      ),
    );

    const client = createXSearchClient("test-token", { fetchImpl });
    const page = await client.searchRecent({
      maxResults: 10,
      query: "communities.buzz.xyz/invite",
    });

    expect(page.posts).toHaveLength(1);
    expect(page.posts[0]?.expandedUrls).toEqual([
      "https://hermesagent.communities.buzz.xyz/invite/v2.abc",
    ]);
    expect(page.newestId).toBe("2082511782912897158");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(calledUrl)).toContain("/2/tweets/search/recent");
    expect(String(calledUrl)).toContain("tweet.fields=created_at%2Centities");
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-token",
    });
  });

  it("passes since_id and next_token when provided", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [], meta: { result_count: 0 } }), {
        status: 200,
      }),
    );
    const client = createXSearchClient("tok", { fetchImpl });
    await client.searchRecent({
      nextToken: "PAGE2",
      query: "q",
      sinceId: "100",
    });
    const [calledUrl] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(String(calledUrl)).toContain("since_id=100");
    expect(String(calledUrl)).toContain("next_token=PAGE2");
  });

  it("maps HTTP 401 to invalid_configuration", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }),
    );
    const client = createXSearchClient("bad", { fetchImpl });
    await expect(
      client.searchRecent({ query: "q" }),
    ).rejects.toMatchObject({
      code: "invalid_configuration",
    });
  });
});
