import type { Pool } from "pg";

import { getCommunityByHost } from "../db/directory";
import { getCandidateInviteTarget } from "../db/join-probes";
import { signNip98 } from "../http/nip98-client";
import {
  acceptJoinPolicy,
  getJoinPolicy,
  isJoinPolicyRequired,
} from "../presence/policy";
import type { WrappingKeyProvider } from "../shared-channels/connector";
import { createFileWrappingKeyProvider } from "../shared-channels/connector";
// SSRF control: reuse the connector's target resolver so a claim can only be
// aimed at the community's on-record relay host — never an arbitrary URL.
import { resolveInviteClaimTarget } from "../shared-channels/installer";
import { recordMembership, withIdentitySecret } from "./store";

export type JoinOutcome =
  | {
      communityId: string | null;
      displayName: string;
      relayHost: string;
      role: string | null;
      status: "joined";
    }
  | { displayName: string; relayHost: string; status: "already_joined" }
  | {
      displayName: string;
      reason: string;
      relayHost: string;
      status: "refused";
    }
  | { displayName: string; relayHost: string; status: "policy_required" }
  | { displayName: string; relayHost: string; status: "not_joinable" }
  | { displayName: string; relayHost: string; status: "unreachable" }
  | {
      displayName: string;
      relayHost: string;
      retryAfterSeconds: number | null;
      status: "rate_limited";
    }
  | { displayName: string; relayHost: string; status: "error" };

/**
 * The HTTP claim, hardened for click-to-join: it inspects the relay's status
 * instead of throwing, so a relay rejection returns a clear outcome rather than
 * an exception the caller might retry. The signed request carries the server-
 * resolved invite code and the consent-minted receipt; nothing here logs or
 * returns key material.
 */
async function claimInvite(
  privateKey: Buffer,
  claimUrl: string,
  code: string,
  policyReceipt: string | undefined,
  relayHost: string,
  displayName: string,
  fetchImpl: typeof fetch,
): Promise<JoinOutcome> {
  const body = JSON.stringify(
    policyReceipt ? { code, policy_receipt: policyReceipt } : { code },
  );
  const authorization = signNip98(Uint8Array.from(privateKey), {
    body,
    method: "POST",
    url: claimUrl,
  });

  let response: Response;
  try {
    response = await fetchImpl(claimUrl, {
      body,
      headers: {
        authorization: `Nostr ${authorization}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
  } catch {
    return { displayName, relayHost, status: "unreachable" };
  }

  const rawText = await response.text().catch(() => "");

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    return {
      displayName,
      relayHost,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
      status: "rate_limited",
    };
  }

  if (response.status === 403) {
    const parsed = safeJson(rawText);
    if (isJoinPolicyRequired(parsed)) {
      return { displayName, relayHost, status: "policy_required" };
    }
    return {
      displayName,
      reason: "This community declined the join request.",
      relayHost,
      status: "refused",
    };
  }

  if (!response.ok) {
    return { displayName, relayHost, status: "error" };
  }

  const parsed = safeJson(rawText);
  return {
    communityId: typeof parsed?.community_id === "string" ? parsed.community_id : null,
    displayName,
    relayHost,
    role: typeof parsed?.role === "string" ? parsed.role : null,
    status: "joined",
  };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Click-to-join with a managed identity. Resolves the community server-side from
 * its candidate id (never trusting a client-supplied relay or invite code),
 * claims the invite with the identity's key, and returns a real outcome. Idempotent: a
 * community already joined short-circuits without another upstream claim, so we
 * do not amplify claim traffic against other people's relays.
 */
export async function joinCommunityWithManagedIdentity(
  pool: Pool,
  input: {
    ageConfirmed: boolean;
    candidateId: string;
    identityId: string;
    policyVersion: string;
  },
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
  fetchImpl: typeof fetch = fetch,
): Promise<JoinOutcome> {
  const inviteTarget = await getCandidateInviteTarget(pool, input.candidateId);
  if (!inviteTarget) {
    return {
      displayName: "Community",
      relayHost: "",
      status: "not_joinable",
    };
  }

  const community = await getCommunityByHost(pool, inviteTarget.host);
  if (!community) {
    return {
      displayName: inviteTarget.host,
      relayHost: inviteTarget.host,
      status: "not_joinable",
    };
  }
  const displayName = community.displayName ?? community.relayHost;

  const already = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM managed_identity_memberships
      WHERE identity_id = $1 AND relay_host = $2
    `,
    [input.identityId, community.relayHost],
  );
  if (already.rows[0]) {
    return { displayName, relayHost: community.relayHost, status: "already_joined" };
  }

  const target = resolveInviteClaimTarget(
    inviteTarget.canonicalRelayUrl,
    inviteTarget.code,
  );

  const outcome = await withIdentitySecret(
    pool,
    input.identityId,
    async (privateKey): Promise<JoinOutcome> => {
      const first = await claimInvite(
        privateKey,
        target.claimUrl,
        target.code,
        undefined,
        community.relayHost,
        displayName,
        fetchImpl,
      );
      if (first.status !== "policy_required") return first;

      let policy: Awaited<ReturnType<typeof getJoinPolicy>>;
      try {
        policy = await getJoinPolicy(inviteTarget.host, fetchImpl);
      } catch {
        return { displayName, relayHost: community.relayHost, status: "unreachable" };
      }
      // The relay demanded a policy but advertises none: contradictory, and we
      // will not invent an attestation on the visitor's behalf.
      if (!policy) {
        return { displayName, relayHost: community.relayHost, status: "error" };
      }
      if (
        policy.version !== input.policyVersion ||
        (policy.ageAttestationRequired && input.ageConfirmed !== true)
      ) {
        return { displayName, relayHost: community.relayHost, status: "error" };
      }

      const accepted = await acceptJoinPolicy({
        ageConfirmed: input.ageConfirmed,
        code: target.code,
        fetchImpl,
        host: inviteTarget.host,
        policyVersion: policy.version,
        privateKey: Uint8Array.from(privateKey),
      });
      if (!accepted.ok) {
        return {
          displayName,
          relayHost: community.relayHost,
          status: accepted.status === 0 ? "unreachable" : "error",
        };
      }

      const retried = await claimInvite(
        privateKey,
        target.claimUrl,
        target.code,
        accepted.receipt,
        community.relayHost,
        displayName,
        fetchImpl,
      );
      return retried.status === "policy_required"
        ? { displayName, relayHost: community.relayHost, status: "error" }
        : retried;
    },
    wrappingKeys,
  );

  if (outcome.status === "joined") {
    await recordMembership(pool, {
      communityId: outcome.communityId,
      identityId: input.identityId,
      relayHost: community.relayHost,
      role: outcome.role,
    });
  }

  return outcome;
}
