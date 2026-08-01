import type { Pool } from "pg";

import { getCommunityByHost } from "../db/directory";
import { signNip98 } from "../http/nip98-client";
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
 * instead of throwing, so a REFUSED claim (403 join_policy_required — the exact
 * silent-spin bug the joinable-truth fix targets) returns a clear outcome rather
 * than an exception the caller might retry. The signed request body carries only
 * the invite code; nothing here logs or returns key material.
 */
async function claimInvite(
  privateKey: Buffer,
  claimUrl: string,
  code: string,
  relayHost: string,
  displayName: string,
  fetchImpl: typeof fetch,
): Promise<JoinOutcome> {
  const body = JSON.stringify({ code });
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
    return {
      displayName,
      reason: refusalReason(rawText),
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
 * A human, non-leaky reason for a 403. We look for the known policy signal and
 * otherwise give a generic message — never echoing arbitrary relay text into
 * our UI verbatim.
 */
function refusalReason(rawText: string): string {
  if (/join_policy_required|join.?policy|approval|pending/i.test(rawText)) {
    return "This community requires manual approval to join.";
  }
  return "This community declined the join request.";
}

/**
 * Click-to-join with a managed identity. Resolves the community server-side from
 * its relay host (never trusting a client-supplied invite code), claims the
 * invite with the identity's key, and returns a real outcome. Idempotent: a
 * community already joined short-circuits without another upstream claim, so we
 * do not amplify claim traffic against other people's relays.
 */
export async function joinCommunityWithManagedIdentity(
  pool: Pool,
  input: { identityId: string; relayHost: string },
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
  fetchImpl: typeof fetch = fetch,
): Promise<JoinOutcome> {
  const community = await getCommunityByHost(pool, input.relayHost);
  if (!community) {
    return {
      displayName: input.relayHost,
      relayHost: input.relayHost,
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

  if (!community.inviteCode) {
    return { displayName, relayHost: community.relayHost, status: "not_joinable" };
  }

  const target = resolveInviteClaimTarget(
    community.canonicalRelayUrl,
    community.inviteCode,
  );

  const outcome = await withIdentitySecret(
    pool,
    input.identityId,
    (privateKey) =>
      claimInvite(
        privateKey,
        target.claimUrl,
        target.code,
        community.relayHost,
        displayName,
        fetchImpl,
      ),
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
