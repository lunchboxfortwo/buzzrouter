/**
 * Live, opt-in verification of the receipt-minting join chain end to end:
 *
 *   fetch policy → accept-policy (with an EXPLICIT age answer) → build the
 *   buzz://join deep link → claim WITH the receipt → assert 200 {status:joined}
 *
 * against a real age-gated Buzz community, using a throwaway key. This is the
 * proof that a server-minted, pubkey-less receipt actually admits a key we do
 * not control — the whole premise of the /join consent flow.
 *
 * It is NOT a test and NEVER runs in CI: it is gated behind an env flag and
 * consumes one real invite use on success (the throwaway key genuinely joins).
 * Run it by hand, once, against one community; respect the relay's
 * 10-claims/60s-per-pubkey limit and do not loop it.
 *
 *   BUZZROUTER_VERIFY_RECEIPT_JOIN_LIVE=1 \
 *   VERIFY_HOST=<host> \
 *   VERIFY_CODE=<invite code> \
 *   VERIFY_AGE_CONFIRMED=true \
 *   node --import tsx scripts/verify-receipt-join.ts
 *
 * No secret is printed: the private key is never emitted and the receipt token
 * is redacted (only its decoded, non-secret expiry is shown).
 */
import { generateSecretKey } from "nostr-tools/pure";

import { claimInvite } from "../src/presence/claim";
import { acceptJoinPolicy, getJoinPolicy } from "../src/presence/policy";
import { buildJoinDeepLink } from "../app/join-urls";

function redact(receipt: string): string {
  return `${receipt.slice(0, 6)}…(${receipt.length} chars)`;
}

function decodedExpiry(receipt: string): string {
  try {
    const payload = receipt.split(".")[0];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof json.e === "number") {
      const seconds = json.e - Math.floor(Date.now() / 1000);
      return `expires in ~${seconds}s (bound to code+version only: ${JSON.stringify({ v: json.v })})`;
    }
  } catch {
    // best-effort only
  }
  return "(could not decode)";
}

async function main(): Promise<void> {
  if (process.env.BUZZROUTER_VERIFY_RECEIPT_JOIN_LIVE !== "1") {
    console.error(
      "Refusing to run: set BUZZROUTER_VERIFY_RECEIPT_JOIN_LIVE=1 to make a live call.",
    );
    process.exit(2);
  }
  const host = process.env.VERIFY_HOST;
  const code = process.env.VERIFY_CODE;
  const ageConfirmed = process.env.VERIFY_AGE_CONFIRMED === "true";
  if (!host || !code) {
    console.error("Set VERIFY_HOST and VERIFY_CODE.");
    process.exit(2);
  }

  const key = generateSecretKey(); // throwaway; the receipt is not bound to it
  console.log(`# receipt-join verification against ${host}`);

  const policy = await getJoinPolicy(host);
  console.log(
    `1. GET /api/join-policy → version=${policy.version.slice(0, 12)}… ` +
      `ageAttestationRequired=${policy.ageAttestationRequired}`,
  );
  if (policy.ageAttestationRequired && !ageConfirmed) {
    console.error(
      "   policy requires an age attestation; set VERIFY_AGE_CONFIRMED=true to proceed (a real assertion).",
    );
    process.exit(1);
  }

  const accepted = await acceptJoinPolicy({
    ageConfirmed,
    code,
    host,
    policyVersion: policy.version,
    privateKey: key,
  });
  if (!accepted.ok) {
    console.error(`2. accept-policy FAILED: ${JSON.stringify(accepted)}`);
    process.exit(1);
  }
  console.log(
    `2. POST /api/invites/accept-policy → receipt ${redact(accepted.receipt)}; ${decodedExpiry(accepted.receipt)}`,
  );

  const deepLink = buildJoinDeepLink(`wss://${host}`, code, accepted.receipt);
  console.log(
    `3. deep link: ${deepLink.replace(accepted.receipt, redact(accepted.receipt))}`,
  );

  const claim = await claimInvite({
    code,
    host,
    policyReceipt: accepted.receipt,
    privateKey: key,
  });
  console.log(
    `4. POST /api/invites/claim (with receipt) → status=${claim.status} ok=${claim.ok} body=${JSON.stringify((claim as { body?: unknown }).body)}`,
  );

  if (claim.ok) {
    console.log("\n✅ VERIFIED: a server-minted receipt admits a throwaway key.");
  } else {
    console.log("\n❌ claim was refused — see status/body above.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("FATAL", error instanceof Error ? error.message : error);
  process.exit(1);
});
