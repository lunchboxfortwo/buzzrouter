import type { JoinStatus } from "../src/directory/joinability";

/**
 * Turns a community's probed claimability into what the directory should show.
 *
 * `join`           — a user can join: a public web-join URL, or any invite code
 *                    we did NOT find owner-only/allowlist. A ToS/age gate is one
 *                    consent click (`/join/[candidateId]` mints a policy
 *                    receipt), not a dead end, so `policy_gated` — and a
 *                    `stale`/unconfirmed code, which degrades into the same
 *                    consent flow rather than being hidden — are joinable.
 * `request-invite` — admission is restricted (owner-only / allowlist); a code
 *                    alone will not get in, so we say so instead of a dead-end
 *                    join button.
 * `none`           — nothing to join with (no code and no public URL).
 */
export type JoinAffordance = "join" | "request-invite" | "none";

export interface JoinabilityView {
  publicUrl: string | null;
  inviteCode: string | null;
  joinStatus: JoinStatus | null;
}

export function joinAffordance(community: JoinabilityView): JoinAffordance {
  if (community.publicUrl) return "join";
  if (!community.inviteCode) return "none";
  if (community.joinStatus === "restricted") return "request-invite";
  // open, policy_gated, stale, unknown, or not-yet-probed: the consent flow at
  // /join/[candidateId] handles the ToS/age handshake (and surfaces a stale code
  // legibly) rather than hiding a community over one extra click.
  return "join";
}

/**
 * The access flag shown on a row/profile. Only a probed-open invite (or a public
 * URL) earns "Open to join"; a code we have not confirmed open reads "Invite-only"
 * so we never over-claim frictionless access.
 */
export function accessFlag(
  community: JoinabilityView,
): "open" | "invite" | null {
  if (community.publicUrl || community.joinStatus === "open") return "open";
  if (community.inviteCode) return "invite";
  return null;
}
