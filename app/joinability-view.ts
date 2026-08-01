import type { JoinStatus } from "../src/directory/joinability";

/**
 * Turns a community's probed claimability into what the directory should show,
 * so the web surface never presents a one-tap join that a claim will refuse.
 *
 * `join`           — a working join path: a public web-join URL, a probed-open
 *                    invite, or an as-yet-unprobed / gated code we still reach
 *                    through the relay's hosted `/invite` onboarding link
 *                    (which runs the full policy handshake in Buzz's own flow).
 * `request-invite` — admission is restricted (owner-only / allowlist); a code
 *                    alone will not get in, so we say so instead of a dead-end
 *                    join button.
 * `none`           — the code is stale (expired/invalid) and there is no other
 *                    join path; the community is still listed, just not joinable.
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
  if (community.joinStatus === "stale") return "none";
  // open, policy_gated, unknown, or not-yet-probed: reachable via the hosted
  // invite link, which completes the join in Buzz's own onboarding flow.
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
