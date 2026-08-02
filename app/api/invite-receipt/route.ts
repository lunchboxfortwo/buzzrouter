import { generateSecretKey } from "nostr-tools/pure";

import { getCandidateInviteTarget } from "../../../src/db/join-probes";
import { getDatabasePool } from "../../../src/db/pool";
import { isUuid } from "../../../src/http/validation";
import { acceptJoinPolicy, getJoinPolicy } from "../../../src/presence/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Mints a Buzz join-policy receipt for one community, at the moment a human
 * consents — the server side of the `/join/[candidateId]` consent flow.
 *
 * Why this exists: Buzz gates most joins behind a ToS + age attestation. The
 * deep link the mobile app reads (`buzz://join?...&policy_receipt=<receipt>`)
 * needs that receipt, and `POST /api/invites/accept-policy` mints one bound only
 * to (code, policy version, expiry) — no pubkey — so we can obtain it for a key
 * we never see. The receipt is SHORT-LIVED (~10 min), so it is minted here on
 * the consent click and handed straight back; it is never cached, stored, or
 * logged, and never pre-computed at page render.
 *
 * Consent integrity:
 *   - `ageConfirmed` is the human's actual checkbox answer, passed through as
 *     `age_confirmed`. If the live policy requires an age attestation and the
 *     caller did not confirm, we REFUSE to mint (400).
 *   - The caller echoes back the policy version it displayed. If the relay's
 *     current version has changed, we return 409 so the client re-shows the new
 *     policy and re-collects consent rather than accepting terms the user never
 *     saw.
 *
 * SSRF: the relay host + advertised code come from our own record for the
 * candidate id (`getCandidateInviteTarget`); no caller-supplied URL or host is
 * ever contacted. `acceptJoinPolicy`/`getJoinPolicy` normalize the host through
 * the shared `normalizeHost`.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "invalid_body");
  }
  if (typeof body !== "object" || body === null) {
    return error(400, "invalid_body");
  }
  const { ageConfirmed, candidateId, policyVersion } = body as Record<
    string,
    unknown
  >;
  if (!isUuid(candidateId)) {
    return error(400, "invalid_candidate");
  }
  if (typeof ageConfirmed !== "boolean") {
    return error(400, "invalid_age_confirmed");
  }
  if (typeof policyVersion !== "string" || policyVersion.length === 0) {
    return error(400, "invalid_policy_version");
  }

  const target = await getCandidateInviteTarget(getDatabasePool(), candidateId);
  if (!target) {
    return error(404, "no_invite");
  }

  // Read the live policy: to enforce the age gate against the real requirement,
  // and to detect a version drift since the user reviewed it.
  let policy: Awaited<ReturnType<typeof getJoinPolicy>>;
  try {
    policy = await getJoinPolicy(target.host);
  } catch {
    return error(502, "policy_unavailable");
  }
  if (policy.version !== policyVersion) {
    // The terms changed under the user — make them review again.
    return error(409, "policy_changed");
  }
  if (policy.ageAttestationRequired && ageConfirmed !== true) {
    return error(400, "age_confirmation_required");
  }

  const accepted = await acceptJoinPolicy({
    ageConfirmed,
    code: target.code,
    host: target.host,
    policyVersion: policy.version,
    // The receipt is bound to (code, policy version, expiry) only — never to a
    // pubkey — so this signature just satisfies the endpoint's NIP-98 header; a
    // throwaway key is correct and keeps us from handling any real identity.
    privateKey: generateSecretKey(),
  });
  if (!accepted.ok) {
    return error(502, "accept_policy_failed");
  }

  // The receipt is returned to the caller ONCE and never persisted or logged.
  return Response.json(
    {
      code: target.code,
      policyVersion: policy.version,
      receipt: accepted.receipt,
      relayUrl: target.canonicalRelayUrl,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

function error(status: number, code: string): Response {
  return Response.json(
    { error: code },
    { headers: { "cache-control": "no-store" }, status },
  );
}
