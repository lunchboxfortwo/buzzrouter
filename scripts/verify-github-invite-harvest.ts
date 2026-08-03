/**
 * One-shot live proof for a GitHub-harvested invite.
 *
 * Selects a non-expired candidate without claiming, optionally completes its
 * policy handshake after an explicit age confirmation, then makes exactly one
 * claim with a fresh throwaway key. It never prints a host, code, private key,
 * receipt, or source locator.
 */
import { generateSecretKey } from "nostr-tools/pure";

import { createDatabasePool } from "../src/db/pool";
import { claimInvite } from "../src/presence/claim";
import { parseInviteExpiry } from "../src/presence/invite-expiry";
import { acceptJoinPolicy, getJoinPolicy } from "../src/presence/policy";
import {
  extractInviteCode,
  fetchGitHubSourceText,
} from "../src/sources/github";

if (process.env.BUZZROUTER_VERIFY_GITHUB_INVITE_LIVE !== "1") {
  throw new Error(
    "Refusing live claim without BUZZROUTER_VERIFY_GITHUB_INVITE_LIVE=1.",
  );
}

const pool = createDatabasePool();

interface ClaimCandidate {
  code: string;
  expiry: number | null;
  host: string;
  policyVersion: string | null;
}

try {
  const result = await pool.query<{
    canonical_relay_url: string;
    host: string;
    source_locator: string;
  }>(
    `
      SELECT cc.canonical_relay_url, cc.host, cs.source_locator
      FROM community_sources cs
      JOIN community_candidates cc ON cc.id = cs.candidate_id
      WHERE cs.source_type = 'github'
        AND cs.source_locator IS NOT NULL
      ORDER BY cs.id
    `,
  );

  const now = Math.floor(Date.now() / 1_000);
  const ageConfirmed = process.env.VERIFY_AGE_CONFIRMED === "true";
  let selected: ClaimCandidate | null = null;
  const gatedCandidates: ClaimCandidate[] = [];
  let expired = 0;
  let policyGated = 0;
  let policyUnknown = 0;
  for (const row of result.rows) {
    let code: string | null = null;
    try {
      const sourceText = await fetchGitHubSourceText(row.source_locator);
      code = extractInviteCode(sourceText, row.canonical_relay_url);
    } catch {
      continue;
    }
    if (!code) continue;
    const expiry = parseInviteExpiry(code);
    if (expiry !== null && expiry <= now) {
      expired += 1;
      continue;
    }

    try {
      const policy = await getJoinPolicy(row.host);
      if (policy === null) {
        selected = { code, expiry, host: row.host, policyVersion: null };
        break;
      }
      policyGated += 1;
      gatedCandidates.push({
        code,
        expiry,
        host: row.host,
        policyVersion: policy.version,
      });
    } catch {
      // A policy endpoint failure makes the row unsuitable for a one-shot
      // proof. Do not gamble the single permitted claim on it.
      policyUnknown += 1;
    }
  }

  if (!selected && ageConfirmed) {
    selected = gatedCandidates.sort(
      (left, right) => (right.expiry ?? 0) - (left.expiry ?? 0),
    )[0] ?? null;
  }

  if (!selected) {
    throw new Error(
      `No policy-free harvested invite was safe for a one-shot claim ` +
        `(expired=${expired}, policyGated=${policyGated}, policyUnknown=${policyUnknown}).`,
    );
  }

  const privateKey = generateSecretKey();
  let policyReceipt: string | undefined;
  if (selected.policyVersion) {
    const accepted = await acceptJoinPolicy({
      ageConfirmed,
      code: selected.code,
      host: selected.host,
      policyVersion: selected.policyVersion,
      privateKey,
    });
    if (!accepted.ok) {
      throw new Error(
        `Join-policy acceptance failed before the single claim (status=${accepted.status}).`,
      );
    }
    policyReceipt = accepted.receipt;
  }

  const claim = await claimInvite({
    code: selected.code,
    host: selected.host,
    policyReceipt,
    privateKey,
  });
  const joined =
    claim.ok &&
    typeof claim.body === "object" &&
    claim.body !== null &&
    (claim.body as Record<string, unknown>).status === "joined";
  console.log(
    JSON.stringify({
      body: joined ? { status: "joined" } : undefined,
      ok: claim.ok,
      status: claim.status,
    }),
  );
  if (!joined || claim.status !== 200) process.exitCode = 1;
} finally {
  await pool.end();
}
