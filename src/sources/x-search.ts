/**
 * Thin X API v2 recent-search client for Buzz invite discovery.
 *
 * Calls `GET /2/tweets/search/recent` with app-only Bearer auth, returns post
 * text plus expanded URL entities so invite extractors can see full
 * `https://host/invite/<code>` links instead of bare t.co redirects.
 */

import { SourceAdapterError } from "./errors";

const DEFAULT_BASE_URL = "https://api.x.com";
/** Tight query: invite paths and communities.buzz.xyz URLs; skip retweets. */
export const DEFAULT_X_INVITE_QUERY =
  '("communities.buzz.xyz/invite" OR url:"communities.buzz.xyz") -is:retweet';
const MAX_RESULTS_PER_PAGE = 100;

export interface XSearchPost {
  id: string;
  text: string;
  /** Expanded URL entities (when the API returned them). */
  expandedUrls: string[];
  createdAt?: string;
}

export interface XSearchPage {
  posts: XSearchPost[];
  newestId: string | null;
  oldestId: string | null;
  nextToken: string | null;
  resultCount: number;
}

export interface XRecentSearchParams {
  query: string;
  /** Only posts newer than this id (exclusive). */
  sinceId?: string | null;
  /** Pagination token from a prior page in the same window. */
  nextToken?: string | null;
  maxResults?: number;
}

export interface XRecentSearchClient {
  searchRecent(params: XRecentSearchParams): Promise<XSearchPage>;
}

interface XApiTweet {
  id?: string;
  text?: string;
  created_at?: string;
  entities?: {
    urls?: Array<{
      url?: string;
      expanded_url?: string;
      display_url?: string;
    }>;
  };
}

interface XApiSearchResponse {
  data?: XApiTweet[];
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    next_token?: string;
    result_count?: number;
  };
  errors?: Array<{ message?: string; title?: string }>;
  detail?: string;
  title?: string;
}

/**
 * Builds an authenticated recent-search client against api.x.com (or a test
 * base URL). Throws SourceAdapterError on HTTP / API failures.
 */
export function createXSearchClient(
  bearerToken: string,
  options: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  } = {},
): XRecentSearchClient {
  const token = bearerToken.trim();
  if (!token) {
    throw new SourceAdapterError(
      "invalid_configuration",
      "X_BEARER_TOKEN is required when X invite discovery is enabled.",
    );
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async searchRecent(params) {
      const url = new URL(`${baseUrl}/2/tweets/search/recent`);
      url.searchParams.set("query", params.query);
      url.searchParams.set(
        "max_results",
        String(
          Math.min(
            Math.max(params.maxResults ?? 10, 10),
            MAX_RESULTS_PER_PAGE,
          ),
        ),
      );
      url.searchParams.set("tweet.fields", "created_at,entities");
      if (params.sinceId) {
        url.searchParams.set("since_id", params.sinceId);
      }
      if (params.nextToken) {
        url.searchParams.set("next_token", params.nextToken);
      }

      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
          },
          method: "GET",
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new SourceAdapterError(
          "remote_failed",
          `X recent search request failed: ${reason}`,
        );
      }

      const bodyText = await response.text();
      let parsed: XApiSearchResponse = {};
      if (bodyText) {
        try {
          parsed = JSON.parse(bodyText) as XApiSearchResponse;
        } catch {
          throw new SourceAdapterError(
            "remote_failed",
            `X recent search returned non-JSON (HTTP ${response.status}).`,
          );
        }
      }

      if (!response.ok) {
        const detail =
          parsed.detail ||
          parsed.title ||
          parsed.errors?.[0]?.message ||
          parsed.errors?.[0]?.title ||
          bodyText.slice(0, 200) ||
          response.statusText;
        const code =
          response.status === 401 || response.status === 403
            ? "invalid_configuration"
            : response.status === 429
              ? "remote_failed"
              : "remote_failed";
        throw new SourceAdapterError(
          code,
          `X recent search HTTP ${response.status}: ${detail}`,
        );
      }

      return parseSearchResponse(parsed);
    },
  };
}

/**
 * Flattens a post into a single scan string: tweet text plus expanded URLs
 * (one per line). Expanded URLs matter because t.co short links hide the
 * `/invite/<code>` path from regex extractors.
 */
export function postTextForExtraction(post: XSearchPost): string {
  if (post.expandedUrls.length === 0) {
    return post.text;
  }
  return [post.text, ...post.expandedUrls].join("\n");
}

function parseSearchResponse(parsed: XApiSearchResponse): XSearchPage {
  const posts: XSearchPost[] = [];
  for (const tweet of parsed.data ?? []) {
    if (typeof tweet.id !== "string" || typeof tweet.text !== "string") {
      continue;
    }
    const expandedUrls: string[] = [];
    for (const entry of tweet.entities?.urls ?? []) {
      if (
        typeof entry.expanded_url === "string" &&
        entry.expanded_url.length > 0
      ) {
        expandedUrls.push(entry.expanded_url);
      }
    }
    posts.push({
      createdAt: tweet.created_at,
      expandedUrls,
      id: tweet.id,
      text: tweet.text,
    });
  }

  return {
    newestId:
      typeof parsed.meta?.newest_id === "string" ? parsed.meta.newest_id : null,
    nextToken:
      typeof parsed.meta?.next_token === "string"
        ? parsed.meta.next_token
        : null,
    oldestId:
      typeof parsed.meta?.oldest_id === "string" ? parsed.meta.oldest_id : null,
    posts,
    resultCount:
      typeof parsed.meta?.result_count === "number"
        ? parsed.meta.result_count
        : posts.length,
  };
}
