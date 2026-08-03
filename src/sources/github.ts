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
const MAX_SOURCE_BYTES = 1_000_000;
const INVITE_NEAR_RELAY_BYTES = 512;
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
  fetchSourceText(htmlUrl: string): Promise<string>;
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
        let sourceText: string;
        try {
          sourceText = await client.fetchSourceText(item.htmlUrl);
        } catch {
          // Do not overwrite a previously harvested credential with null just
          // because this raw fetch was transiently unavailable. The next
          // discovery pass can retry the whole source row safely.
          continue;
        }
        const candidateUrls = new Set(
          item.fragments.flatMap(extractRelayUrls),
        );

        for (const relayUrl of candidateUrls) {
          const inviteCode = extractInviteCode(sourceText, relayUrl);
          const ingestion = await ingestSourceCandidate(pool, boss, {
            relayUrl,
            source: {
              type: "github",
              locator: item.htmlUrl,
              evidenceId: item.evidenceId,
              listing: { inviteCode },
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
  fetchImpl: typeof fetch = fetch,
): GitHubCodeSearchClient {
  const octokit = new Octokit({
    baseUrl,
    userAgent: "BuzzRouter-Discovery/0.2",
  });

  return {
    async fetchSourceText(htmlUrl) {
      return fetchGitHubSourceText(htmlUrl, fetchImpl);
    },
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

/** Rewrites GitHub's code-search blob URL onto GitHub's raw-content origin. */
export function githubBlobToRawUrl(htmlUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(htmlUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 5 || parts[2] !== "blob") return null;
  const [owner, repository, , revision, ...path] = parts;
  if (
    !/^[A-Za-z0-9_.-]+$/u.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/u.test(repository) ||
    !/^[A-Za-z0-9_.-]+$/u.test(revision) ||
    path.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }

  const raw = new URL("https://raw.githubusercontent.com/");
  raw.pathname = [owner, repository, revision, ...path].join("/");
  return raw.toString();
}

/** Fetches one public GitHub source file with a hard response-size ceiling. */
export async function fetchGitHubSourceText(
  htmlUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const rawUrl = githubBlobToRawUrl(htmlUrl);
  if (!rawUrl) throw new Error("GitHub source URL is not a supported blob URL.");

  const response = await fetchImpl(rawUrl, {
    headers: { accept: "text/plain" },
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub raw source returned HTTP ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    throw new Error("GitHub raw source exceeds the configured size limit.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("GitHub raw source exceeds the configured size limit.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/**
 * Extracts an invite only when the nearest relay URL in the untrusted file is
 * the candidate being ingested. This binds relative/bare codes to their own
 * community and prevents a multi-community file from crossing credentials.
 */
export function extractInviteCode(
  sourceText: string,
  canonicalRelayUrl: string,
): string | null {
  const targetHost = relayAuthority(canonicalRelayUrl);
  if (!targetHost) return null;

  const relayOccurrences = [...sourceText.matchAll(URL_PATTERN)].flatMap(
    (match) => {
      const relay = relayUrlIdentity(
        match[0].replace(URL_TRAILING_PUNCTUATION, ""),
      );
      return relay && !isIgnoredGitHubHost(relay.hostname)
        ? [{
            end: (match.index ?? 0) + match[0].length,
            host: relay.authority,
            start: match.index ?? 0,
          }]
        : [];
    },
  );
  const inviteOccurrences = [
    ...sourceText.matchAll(/\/invite\/([A-Za-z0-9_.=-]{1,200})/gu),
    ...sourceText.matchAll(/\b(v2\.[A-Za-z0-9_-]{16,196})\b/gu),
    ...sourceText.matchAll(
      /\b([A-Za-z0-9_-]{8,160}\.[A-Za-z0-9_-]{8,100})\b/gu,
    ),
  ].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));

  for (const occurrence of inviteOccurrences) {
    const code = occurrence[1];
    if (!isHarvestableInviteCode(code)) continue;
    const codeIndex = (occurrence.index ?? 0) + occurrence[0].indexOf(code);
    let nearest: (typeof relayOccurrences)[number] | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const relay of relayOccurrences) {
      const distance =
        codeIndex < relay.start
          ? relay.start - codeIndex
          : codeIndex > relay.end
            ? codeIndex - relay.end
            : 0;
      if (distance < nearestDistance) {
        nearest = relay;
        nearestDistance = distance;
      }
    }
    if (
      nearest?.host === targetHost &&
      nearestDistance <= INVITE_NEAR_RELAY_BYTES
    ) {
      return code;
    }
  }
  return null;
}

/** Accepts opaque v2 tokens and expiry-bearing legacy JSON tokens only. */
export function isHarvestableInviteCode(code: string): boolean {
  if (code.length > 200) return false;
  if (/^v2\.[A-Za-z0-9_-]{16,196}$/u.test(code)) return true;
  const match =
    /^([A-Za-z0-9_-]{8,160})\.([A-Za-z0-9_-]{8,100})$/u.exec(code);
  if (!match) return false;
  try {
    const parsed = JSON.parse(
      Buffer.from(match[1], "base64url").toString("utf8"),
    ) as { e?: unknown };
    return (
      typeof parsed.e === "number" &&
      Number.isFinite(parsed.e) &&
      parsed.e > 0
    );
  } catch {
    return false;
  }
}

function relayAuthority(value: string): string | null {
  return relayUrlIdentity(value)?.authority ?? null;
}

function relayUrlIdentity(
  value: string,
): { authority: string; hostname: string } | null {
  try {
    const parsed = new URL(value);
    return {
      authority: parsed.host.toLowerCase(),
      hostname: parsed.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
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
