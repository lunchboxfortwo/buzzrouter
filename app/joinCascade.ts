"use client";

import { buildInviteUrl, buildJoinDeepLink } from "./join-urls";

// Re-exported so existing client callers can keep importing them from here; the
// implementations are pure and live in the server/client-shared join-urls module.
export { buildInviteUrl, buildJoinDeepLink };

export interface JoinTarget {
  /** Candidate id, when known — routes to the consent flow at /join/<id>. */
  candidateId?: string | null;
  inviteCode: string | null;
  publicUrl: string | null;
  relayUrl: string;
}

export function hasJoinTarget(target: JoinTarget): boolean {
  return Boolean(target.inviteCode || target.publicUrl);
}

/**
 * One join cascade, shared by the inspector button and the mobile list cell.
 *
 * - Invite code present: open our `/join/<candidateId>` consent page, which
 *   shows the community's actual join policy, collects a real consent tick, then
 *   mints a policy receipt and hands off to Buzz with a working deep link. (When
 *   the candidate id is unknown we fall back to the relay's hosted invite page.)
 * - Public URL present: open the web experience in a new tab.
 * - Neither: nothing to launch; the caller keeps its own behavior.
 */
export function launchJoin(target: JoinTarget): boolean {
  if (target.inviteCode) {
    const url = target.candidateId
      ? `/join/${encodeURIComponent(target.candidateId)}`
      : buildInviteUrl(target.relayUrl, target.inviteCode);
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }

  if (target.publicUrl) {
    window.open(target.publicUrl, "_blank", "noopener,noreferrer");
    return true;
  }

  return false;
}
