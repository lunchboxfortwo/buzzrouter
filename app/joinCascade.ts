"use client";

export interface JoinTarget {
  inviteCode: string | null;
  publicUrl: string | null;
  relayUrl: string;
}

/** Bare host from a `wss://host[/]` (or `https://…`) relay URL. */
function relayHost(relayUrl: string): string {
  return relayUrl.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "");
}

/**
 * Builds the hosted web invite link the relay serves at
 * `https://<host>/invite/<code>` — the same link Buzz itself generates for
 * sharing. Opening it runs the full join handshake (policy → accept → claim)
 * inside Buzz's own web/app flow and works whether or not the app is installed.
 *
 * We deliberately do NOT synthesize a `buzz://join?relay=…&code=…` deep link:
 * the app's handler for that scheme skips the join-policy step (desktop returned
 * `join_policy_required`) or mishandles the approval receipt (mobile), so it
 * fails where the hosted link succeeds. Verified live on both platforms.
 */
export function buildInviteUrl(relayUrl: string, inviteCode: string): string {
  return `https://${relayHost(relayUrl)}/invite/${encodeURIComponent(inviteCode)}`;
}

export function hasJoinTarget(target: JoinTarget): boolean {
  return Boolean(target.inviteCode || target.publicUrl);
}

/**
 * One join cascade, shared by the inspector button and the mobile list cell.
 *
 * - Invite code present: open the relay's hosted web invite page in a new tab.
 *   It carries out the join in Buzz's own flow, hands off to the app when it is
 *   installed (associated link), and falls back to the browser otherwise —
 *   sidestepping the broken `buzz://` deep-link handler entirely.
 * - Public URL present: open the web experience in a new tab.
 * - Neither: nothing to launch; the caller keeps its own behavior.
 */
export function launchJoin(target: JoinTarget): boolean {
  if (target.inviteCode) {
    const url = buildInviteUrl(target.relayUrl, target.inviteCode);
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }

  if (target.publicUrl) {
    window.open(target.publicUrl, "_blank", "noopener,noreferrer");
    return true;
  }

  return false;
}
