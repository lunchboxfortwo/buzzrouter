import { createHash, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import type { Pool } from "pg";

import { resolvePublicAddresses } from "../discovery/network-policy";
import { fetchNip11, createPinnedLookup } from "../discovery/probe";
import { ClaimError } from "./errors";
import type { ClaimChallengeRecord } from "./store";

const CONNECT_TIMEOUT_MS = 3_000;
const TOTAL_TIMEOUT_MS = 5_000;
const HTTP_BODY_LIMIT_BYTES = 64 * 1_024;

export interface ClaimInstructions {
  method: ClaimChallengeRecord["method"];
  name?: string;
  url?: string;
  value?: string;
}

export function createTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createClaimInstructions(
  challenge: ClaimChallengeRecord,
  token: string,
): ClaimInstructions {
  if (challenge.method === "dns_txt") {
    return {
      method: challenge.method,
      name: `_buzzrouter.${challenge.host}`,
      value: `buzzrouter-claim=${token}`,
    };
  }
  if (challenge.method === "http_file") {
    return {
      method: challenge.method,
      url: `https://${challenge.host}/.well-known/buzzrouter.json`,
      value: JSON.stringify({
        nonce: token,
        pubkey: challenge.claimantPubkey,
      }),
    };
  }

  const origin = requiredPublicOrigin();
  return {
    method: challenge.method,
    url: new URL(
      `/api/claims/icon/${challenge.challengeId}/${token}.png`,
      origin,
    ).toString(),
  };
}

export async function verifyClaimProof(
  challenge: ClaimChallengeRecord,
): Promise<void> {
  if (challenge.method === "dns_txt") {
    await verifyDnsProof(challenge);
    return;
  }
  if (challenge.method === "http_file") {
    await verifyHttpProof(challenge);
    return;
  }

  await verifyHostedIconProof(challenge);
}

export async function validateIconToken(
  pool: Pool,
  challengeId: string,
  token: string,
  isValid: (
    pool: Pool,
    challengeId: string,
    tokenHash: string,
  ) => Promise<boolean>,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    return false;
  }
  return isValid(pool, challengeId, createTokenHash(token));
}

async function verifyDnsProof(
  challenge: ClaimChallengeRecord,
): Promise<void> {
  let records: string[][];
  try {
    records = await withDeadline(
      resolveTxt(`_buzzrouter.${challenge.host}`),
      TOTAL_TIMEOUT_MS,
    );
  } catch (error) {
    throw proofNotFound(error);
  }
  if (records.length > 20) {
    throw proofNotFound();
  }

  const values = records.map((record) => record.join(""));
  if (
    values.reduce((total, value) => total + value.length, 0) > 4_096 ||
    !values.some((value) =>
      value.startsWith("buzzrouter-claim=") &&
      tokenMatches(value.slice("buzzrouter-claim=".length), challenge.tokenHash),
    )
  ) {
    throw proofNotFound();
  }
}

async function verifyHttpProof(
  challenge: ClaimChallengeRecord,
): Promise<void> {
  const target = new URL(
    `https://${challenge.host}/.well-known/buzzrouter.json`,
  );
  const body = await fetchPinnedBody(target);

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw proofNotFound(error);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw proofNotFound();
  }

  const proof = value as Record<string, unknown>;
  if (
    proof.pubkey !== challenge.claimantPubkey ||
    typeof proof.nonce !== "string" ||
    !tokenMatches(proof.nonce, challenge.tokenHash)
  ) {
    throw proofNotFound();
  }
}

async function verifyHostedIconProof(
  challenge: ClaimChallengeRecord,
): Promise<void> {
  let icon: string | undefined;
  try {
    const result = await fetchNip11(challenge.canonicalRelayUrl);
    icon = result.document.icon;
  } catch (error) {
    throw proofNotFound(error);
  }
  if (!icon) {
    throw proofNotFound();
  }

  let parsed: URL;
  try {
    parsed = new URL(icon);
  } catch {
    throw proofNotFound();
  }
  const origin = requiredPublicOrigin();
  const expectedPrefix = `/api/claims/icon/${challenge.challengeId}/`;
  if (
    parsed.origin !== origin.origin ||
    !parsed.pathname.startsWith(expectedPrefix) ||
    !parsed.pathname.endsWith(".png") ||
    parsed.search ||
    parsed.hash
  ) {
    throw proofNotFound();
  }

  const token = parsed.pathname.slice(
    expectedPrefix.length,
    -".png".length,
  );
  if (!tokenMatches(token, challenge.tokenHash)) {
    throw proofNotFound();
  }
}

async function fetchPinnedBody(target: URL): Promise<string> {
  const addresses = await resolvePublicAddresses(target.hostname);
  const pinned = addresses[0];

  return new Promise((resolve, reject) => {
    let settled = false;
    const request = httpsRequest(
      target,
      {
        headers: {
          accept: "application/json",
          "accept-encoding": "identity",
          "user-agent": "BuzzRouter-Claims/0.1",
        },
        lookup: createPinnedLookup(pinned),
        method: "GET",
        rejectUnauthorized: true,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          fail();
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > HTTP_BODY_LIMIT_BYTES) {
            response.destroy();
            fail();
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => {
          succeed(Buffer.concat(chunks).toString("utf8"));
        });
        response.once("error", () => fail());
      },
    );
    const totalTimer = setTimeout(() => {
      request.destroy();
      fail();
    }, TOTAL_TIMEOUT_MS);
    request.setTimeout(CONNECT_TIMEOUT_MS, () => {
      request.destroy();
      fail();
    });
    request.once("error", () => fail());
    request.end();

    function succeed(body: string) {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      resolve(body);
    }

    function fail() {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      reject(proofNotFound());
    }
  });
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(proofNotFound()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function tokenMatches(token: string, expectedHash: string): boolean {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    return false;
  }

  const actual = Buffer.from(createTokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}

function requiredPublicOrigin(): URL {
  const value = process.env.PUBLIC_APP_ORIGIN;
  if (!value) {
    throw new Error("PUBLIC_APP_ORIGIN is required.");
  }

  const origin = new URL(value);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && origin.protocol === "http:"))
  ) {
    throw new Error("PUBLIC_APP_ORIGIN must be an HTTPS origin.");
  }
  return origin;
}

function proofNotFound(cause?: unknown): ClaimError {
  return new ClaimError(
    "proof_not_found",
    "Claim proof was not found.",
    409,
    { cause: cause instanceof Error ? cause : undefined },
  );
}
