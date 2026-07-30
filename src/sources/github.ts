import { Octokit } from "@octokit/rest";
import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  getSourceCursor,
  recordSourceFailure,
  recordSourceSuccess,
  type SourceCursor,
} from "../db/source-state";
import { ingestSourceCandidate } from "./ingest";
import { SourceAdapterError } from "./errors";

const SOURCE_KEY = "github";
const RESULTS_PER_PAGE = 100;
const MAX_PAGES_PER_RUN = 3;
const DEFAULT_QUERIES = [
  '"communities.buzz.xyz" -repo:block/buzz',
  "BUZZ_RELAY_URL -repo:block/buzz",
];
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s<>"'`]+/giu;
const URL_TRAILING_PUNCTUATION = /[),.;:\]}>]+$/u;
const IGNORED_HOSTS = new Set([
  "127.0.0.1",
  "github.com",
  "localhost",
  "raw.githubusercontent.com",
  "example.com",
]);
const IGNORED_BUZZ_TENANTS = new Set([
  "acme",
  "beta",
  "example",
  "mycommunity",
  "north-star",
  "pending-seed",
  "you",
  "your-community",
  "yourteam",
]);
const IGNORED_HOST_SUFFIXES = [
  ".example.com",
  ".example.net",
  ".example.org",
  ".local",
];

export interface GitHubCursor extends SourceCursor {
  queryIndex: number;
  page: number;
}

export interface GitHubCodeSearchItem {
  evidenceId: string;
  htmlUrl: string;
  fragments: string[];
}

export interface GitHubCodeSearchPage {
  incomplete: boolean;
  items: GitHubCodeSearchItem[];
  totalCount: number;
}

interface GitHubCodeSearchResponse {
  incomplete_results: boolean;
  items: Array<{
    html_url: string;
    path: string;
    repository: {
      full_name: string;
    };
    text_matches?: Array<{ fragment?: string }>;
  }>;
  total_count: number;
}

export interface GitHubCodeSearchClient {
  searchCode(
    query: string,
    page: number,
    perPage: number,
  ): Promise<GitHubCodeSearchPage>;
}

export interface GitHubSourceResult {
  candidatesAccepted: number;
  candidatesIgnored: number;
  pagesRead: number;
}

export async function runGitHubSource(
  pool: Pool,
  boss: PgBoss,
  client: GitHubCodeSearchClient,
  queries = DEFAULT_QUERIES,
): Promise<GitHubSourceResult> {
  validateQueries(queries);
  let cursor = sanitizeGitHubCursor(
    await getSourceCursor<GitHubCursor>(pool, SOURCE_KEY, {
      queryIndex: 0,
      page: 1,
    }),
    queries.length,
  );
  const result: GitHubSourceResult = {
    candidatesAccepted: 0,
    candidatesIgnored: 0,
    pagesRead: 0,
  };

  try {
    while (
      cursor.queryIndex < queries.length &&
      result.pagesRead < MAX_PAGES_PER_RUN
    ) {
      const query = queries[cursor.queryIndex];
      const page = await client.searchCode(
        query,
        cursor.page,
        RESULTS_PER_PAGE,
      );
      result.pagesRead += 1;

      for (const item of page.items) {
        const candidateUrls = new Set(
          item.fragments.flatMap(extractRelayUrls),
        );

        for (const relayUrl of candidateUrls) {
          const ingestion = await ingestSourceCandidate(pool, boss, {
            relayUrl,
            source: {
              type: "github",
              locator: item.htmlUrl,
              evidenceId: item.evidenceId,
            },
          });
          if (ingestion.accepted) {
            result.candidatesAccepted += 1;
          } else {
            result.candidatesIgnored += 1;
          }
        }
      }

      if (page.incomplete) {
        await recordSourceFailure(pool, SOURCE_KEY, "incomplete_results");
        throw new SourceAdapterError(
          "incomplete_results",
          "GitHub returned incomplete code search results.",
        );
      }

      const reachedQueryEnd = hasReachedGitHubQueryEnd(
        page,
        cursor.page,
      );
      cursor = reachedQueryEnd
        ? {
            queryIndex: cursor.queryIndex + 1,
            page: 1,
          }
        : {
            queryIndex: cursor.queryIndex,
            page: cursor.page + 1,
          };

      await recordSourceSuccess(pool, SOURCE_KEY, cursor, result);
    }

    if (cursor.queryIndex >= queries.length) {
      cursor = { queryIndex: 0, page: 1 };
      await recordSourceSuccess(pool, SOURCE_KEY, cursor, result);
    }

    return result;
  } catch (error) {
    if (error instanceof SourceAdapterError) {
      throw error;
    }

    const errorCode = githubErrorCode(error);
    await recordSourceFailure(pool, SOURCE_KEY, errorCode);
    throw new SourceAdapterError(
      errorCode,
      `GitHub source failed: ${errorCode}.`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export function createGitHubSearchClient(
  token: string,
  baseUrl = "https://api.github.com",
): GitHubCodeSearchClient {
  const octokit = new Octokit({
    baseUrl,
    userAgent: "BuzzRouter-Discovery/0.2",
  });

  return {
    async searchCode(query, page, perPage) {
      const response = await octokit.rest.search.code({
        headers: {
          accept: "application/vnd.github.text-match+json",
          authorization: `Bearer ${token}`,
        },
        page,
        per_page: perPage,
        q: query,
      });
      const data = parseGitHubCodeSearchResponse(response.data);

      return {
        incomplete: data.incomplete_results,
        totalCount: data.total_count,
        items: data.items.map((item) => {
          return {
            evidenceId: `${item.repository.full_name}:${item.path}`,
            htmlUrl: item.html_url,
            fragments:
              item.text_matches
                ?.map((match) => match.fragment)
                .filter((fragment): fragment is string => Boolean(fragment)) ??
              [],
          };
        }),
      };
    },
  };
}

export function parseGitHubCodeSearchResponse(
  input: unknown,
): GitHubCodeSearchResponse {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("incomplete_results" in parsed) ||
    typeof parsed.incomplete_results !== "boolean" ||
    !("total_count" in parsed) ||
    typeof parsed.total_count !== "number" ||
    !("items" in parsed) ||
    !Array.isArray(parsed.items)
  ) {
    throw new Error("GitHub code search response is invalid.");
  }

  return parsed as GitHubCodeSearchResponse;
}

export function extractRelayUrls(fragment: string): string[] {
  return [...fragment.matchAll(URL_PATTERN)]
    .map((match) => match[0].replace(URL_TRAILING_PUNCTUATION, ""))
    .filter((candidate) => {
      try {
        const parsed = new URL(candidate);
        const hostname = parsed.hostname.toLowerCase();
        if (isIgnoredGitHubHost(hostname)) {
          return false;
        }

        return parsed.protocol === "ws:" ||
          parsed.protocol === "wss:" ||
          hostname.endsWith(".communities.buzz.xyz");
      } catch {
        return false;
      }
    });
}

export function isIgnoredGitHubHost(hostname: string): boolean {
  if (
    IGNORED_HOSTS.has(hostname) ||
    IGNORED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    hostname.includes(".x.")
  ) {
    return true;
  }

  const buzzSuffix = ".communities.buzz.xyz";
  if (!hostname.endsWith(buzzSuffix)) {
    return false;
  }

  return IGNORED_BUZZ_TENANTS.has(hostname.slice(0, -buzzSuffix.length));
}

function validateQueries(queries: string[]): void {
  if (
    queries.length === 0 ||
    queries.length > 5 ||
    queries.some((query) => query.length === 0 || query.length > 256)
  ) {
    throw new SourceAdapterError(
      "invalid_configuration",
      "GitHub source queries are outside the configured bounds.",
    );
  }
}

export function sanitizeGitHubCursor(
  cursor: GitHubCursor,
  queryCount: number,
): GitHubCursor {
  if (
    !Number.isInteger(cursor.queryIndex) ||
    cursor.queryIndex < 0 ||
    cursor.queryIndex >= queryCount ||
    !Number.isInteger(cursor.page) ||
    cursor.page < 1 ||
    cursor.page > 10
  ) {
    return { queryIndex: 0, page: 1 };
  }

  return cursor;
}

export function hasReachedGitHubQueryEnd(
  page: GitHubCodeSearchPage,
  pageNumber: number,
): boolean {
  return (
    page.items.length < RESULTS_PER_PAGE ||
    pageNumber * RESULTS_PER_PAGE >= page.totalCount ||
    pageNumber >= 10
  );
}

function githubErrorCode(error: unknown):
  | "rate_limited"
  | "remote_failed" {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : null;

  return status === 403 || status === 429
    ? "rate_limited"
    : "remote_failed";
}
