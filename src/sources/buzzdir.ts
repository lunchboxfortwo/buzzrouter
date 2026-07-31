import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import ts from "typescript";

import {
  recordSourceFailure,
  recordSourceSuccess,
} from "../db/source-state";
import { SourceAdapterError } from "./errors";
import { ingestSourceCandidate } from "./ingest";

const SOURCE_KEY = "buzzdir";
const CATALOG_RAW_URL =
  "https://raw.githubusercontent.com/pavlenex/buzz-directory/main/app/communities.ts";
const CATALOG_SOURCE_URL =
  "https://github.com/pavlenex/buzz-directory/blob/main/app/communities.ts";
const MAX_CATALOG_BYTES = 256 * 1_024;
const MAX_CATALOG_ENTRIES = 200;
const ALLOWED_CATEGORIES = new Set([
  "bitcoin",
  "builders",
  "culture",
  "gtm",
  "labs",
  "privacy",
]);

export interface BuzzdirCatalogEntry {
  category: string;
  description: string;
  inviteCode: string | null;
  name: string;
  publicUrl: string | null;
  relay: string;
}

export interface BuzzdirCatalogClient {
  fetchCatalog(): Promise<string>;
}

export interface BuzzdirSourceResult {
  candidatesAccepted: number;
  candidatesIgnored: number;
  listingsRead: number;
}

export async function runBuzzdirSource(
  pool: Pool,
  boss: PgBoss,
  client: BuzzdirCatalogClient,
): Promise<BuzzdirSourceResult> {
  const result: BuzzdirSourceResult = {
    candidatesAccepted: 0,
    candidatesIgnored: 0,
    listingsRead: 0,
  };

  try {
    const catalog = parseBuzzdirCatalog(await client.fetchCatalog());
    result.listingsRead = catalog.length;

    for (const entry of catalog) {
      const ingestion = await ingestSourceCandidate(pool, boss, {
        relayUrl: entry.relay,
        source: {
          evidenceId: entry.relay,
          listing: {
            categories: [entry.category],
            description: entry.description,
            displayName: entry.name,
            inviteCode: entry.inviteCode,
            publicUrl: entry.publicUrl,
          },
          locator: CATALOG_SOURCE_URL,
          type: "buzzdir",
        },
      });

      if (ingestion.accepted) {
        result.candidatesAccepted += 1;
      } else {
        result.candidatesIgnored += 1;
      }
    }

    await recordSourceSuccess(pool, SOURCE_KEY, { version: 1 }, result);
    return result;
  } catch (error) {
    await recordSourceFailure(pool, SOURCE_KEY, "remote_failed");
    throw new SourceAdapterError(
      "remote_failed",
      "Buzzdir catalog discovery failed.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export function createBuzzdirCatalogClient(
  catalogUrl = CATALOG_RAW_URL,
): BuzzdirCatalogClient {
  return {
    async fetchCatalog() {
      const response = await fetch(catalogUrl, {
        headers: {
          accept: "text/plain",
          "user-agent": "BuzzRouter-Discovery/0.3",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok || !response.body) {
        throw new Error(`Catalog request failed with ${response.status}.`);
      }

      const contentLength = response.headers.get("content-length");
      if (
        contentLength &&
        (!/^\d+$/.test(contentLength) ||
          Number(contentLength) > MAX_CATALOG_BYTES)
      ) {
        throw new Error("Catalog response is too large.");
      }

      return readBoundedText(response.body, MAX_CATALOG_BYTES);
    },
  };
}

export function parseBuzzdirCatalog(sourceText: string): BuzzdirCatalogEntry[] {
  const source = ts.createSourceFile(
    "communities.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (candidate) =>
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === "communities",
    );
  const initializer = declaration?.initializer
    ? unwrapExpression(declaration.initializer)
    : undefined;
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    throw new Error("Buzzdir catalog does not export a literal array.");
  }
  if (initializer.elements.length > MAX_CATALOG_ENTRIES) {
    throw new Error("Buzzdir catalog contains too many entries.");
  }

  const entries = initializer.elements.map((element) => {
    const value = unwrapExpression(element);
    if (!ts.isObjectLiteralExpression(value)) {
      throw new Error("Buzzdir catalog entry is not a literal object.");
    }

    const name = readStringProperty(value, "name");
    const description = readStringProperty(value, "description");
    const category = readStringProperty(value, "category").toLowerCase();
    const relay = readStringProperty(value, "relay");
    const publicUrl = readOptionalStringProperty(value, "publicUrl");
    const inviteCode = extractInviteCode(
      readOptionalStringProperty(value, "inviteUrl"),
    );
    if (
      Array.from(name).length < 2 ||
      Array.from(name).length > 80 ||
      Array.from(description).length > 500 ||
      !ALLOWED_CATEGORIES.has(category) ||
      !relay.startsWith("wss://")
    ) {
      throw new Error("Buzzdir catalog entry is outside accepted bounds.");
    }

    return { category, description, inviteCode, name, publicUrl, relay };
  });
  if (new Set(entries.map((entry) => entry.relay)).size !== entries.length) {
    throw new Error("Buzzdir catalog contains duplicate relays.");
  }

  return entries;
}

function readOptionalStringProperty(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): string | null {
  const property = object.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      propertyText(candidate.name) === propertyName,
  );
  if (!property || !ts.isPropertyAssignment(property)) {
    return null;
  }
  const value = unwrapExpression(property.initializer);
  if (!ts.isStringLiteralLike(value)) {
    return null;
  }
  const text = value.text.replace(/\s+/gu, " ").trim();
  return text.length > 0 ? text : null;
}

/**
 * Canonical invite links are `https://<relay>/invite/<code>`. Only the code is
 * kept; the code is what the Buzz app's `buzz://join` handoff needs.
 */
function extractInviteCode(inviteUrl: string | null): string | null {
  if (!inviteUrl) return null;
  const match = /\/invite\/([^/?#]+)/u.exec(inviteUrl);
  return match ? decodeURIComponent(match[1]) : null;
}

function readStringProperty(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): string {
  const property = object.properties.find((candidate) => {
    if (!ts.isPropertyAssignment(candidate)) {
      return false;
    }
    return propertyText(candidate.name) === propertyName;
  });
  if (!property || !ts.isPropertyAssignment(property)) {
    throw new Error(`Buzzdir entry is missing ${propertyName}.`);
  }

  const value = unwrapExpression(property.initializer);
  if (!ts.isStringLiteralLike(value)) {
    throw new Error(`Buzzdir ${propertyName} is not a string literal.`);
  }

  return value.text.replace(/\s+/gu, " ").trim();
}

function propertyText(name: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

async function readBoundedText(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new Error("Catalog response is too large.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}
