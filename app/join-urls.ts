/**
 * Pure join-URL builders, usable from BOTH server and client (no `"use client"`,
 * no `window`). `joinCascade.ts` re-exports these for its client callers; the
 * server-rendered `/join/[candidateId]` page imports them directly.
 */

/** Bare host from a `wss://host[/]` (or `https://…`) relay URL. */
function relayHost(relayUrl: string): string {
  return relayUrl.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "");
}

/**
 * Builds the hosted web invite link the relay serves at
 * `https://<host>/invite/<code>` — Buzz's own onboarding page. Used as the
 * DESKTOP / no-app fallback: opening it runs the full join handshake in the
 * browser and works without the app installed.
 */
export function buildInviteUrl(relayUrl: string, inviteCode: string): string {
  return `https://${relayHost(relayUrl)}/invite/${encodeURIComponent(inviteCode)}`;
}

/**
 * Builds the `buzz://join` deep link the mobile app reads. It CARRIES the
 * short-lived policy receipt (`policy_receipt`): the app's handler skips the ToS
 * handshake, so a receipt-less deep link is refused `join_policy_required` (the
 * reported dead-end), but the app DOES read a receipt from the link and claims
 * with it. The receipt expires in ~10 minutes, so this is only ever built at the
 * moment of consent from a freshly minted receipt — never cached or precomputed.
 */
export function buildJoinDeepLink(
  relayUrl: string,
  inviteCode: string,
  // Null when the community configured no join policy: there is no receipt to
  // carry, and a bare claim admits the joiner. Sending an empty policy_receipt
  // would be worse than omitting it.
  policyReceipt: string | null,
): string {
  const params = new URLSearchParams({
    code: inviteCode,
    relay: relayUrl,
  });
  if (policyReceipt) params.set("policy_receipt", policyReceipt);
  return `buzz://join?${params.toString()}`;
}
