const API_ERROR_MESSAGES: Record<string, string> = {
  authentication_invalid: "The signed request was not accepted.",
  authentication_required: "Reconnect to your community and try again.",
  channel_already_routed:
    "That channel is already connected to the hub. Pick a different channel.",
  channel_create_failed:
    "The new channel could not be created on your relay. Try again.",
  channel_event_not_stored:
    "Your relay accepted the channel update but did not retain it. Try again.",
  channel_handoff_incomplete:
    "The channel was created, but ownership transfer did not finish. Try the same create action again to resume it.",
  channel_owner_unavailable:
    "Your relay did not return a verified owner or admin for this channel. Check the community roster and try again.",
  community_owner_required:
    "Only an owner or admin of that community can do this.",
  connection_already_active:
    "This community is already connected. Paste a fresh owner or admin invite to reopen its settings.",
  connection_activation_failed:
    "We couldn’t finish connecting this community. Try pasting the invite again.",
  destination_not_verified:
    "That community isn’t verified yet, so it can’t take hub traffic.",
  featured_unavailable:
    "The BuzzRouter hub isn’t accepting connections right now. Try again shortly.",
  hub_filter_invalid: "That filter list wasn’t valid. Check it and try again.",
  invite_community_unknown:
    "We don’t have that community on record yet. List it first, then connect it.",
  owner_session_forbidden:
    "That session isn’t for this community. Paste your invite link again.",
  route_inactive: "That connection isn’t active, so it can’t be changed.",
  wrapping_key_version_invalid:
    "The connector isn’t configured correctly on our side. This is our bug, not yours.",
  connection_required: "The community connector must be active first.",
  connector_key_unavailable:
    "The connector for this community isn’t ready yet. Try again shortly.",
  connector_package_unavailable:
    "The connector package is temporarily unavailable. Try again shortly.",
  connector_round_trip_failed:
    "The bot isn’t admitted to your community yet. Make sure you added it, then try again.",
  hub_membership_not_found:
    "This community isn’t connected to the hub yet. Paste an owner or admin invite link to connect it.",
  install_token_unavailable:
    "That connection session has expired or was already used. Request a new one.",
  invalid_input: "Some of that wasn’t valid. Check the fields and try again.",
  invite_claim_rejected:
    "Your relay rejected that invite. Check it hasn’t expired or run out of uses, then paste a fresh one.",
  invite_claim_unreachable:
    "We couldn’t reach your community’s relay to redeem the invite. Try again shortly.",
  invite_host_mismatch:
    "That invite link is for a different relay than this community.",
  invite_invalid: "That doesn’t look like a valid Buzz invite link.",
  owner_session_invalid:
    "That session expired. Paste your invite link again to reconnect.",
  shared_channel_failed: "The hub connection could not be completed.",
  source_channel_mismatch:
    "That message came from a channel this community hasn’t connected.",
  wrapping_key_file_invalid:
    "The connector isn’t configured correctly on our side. This is our bug, not yours.",
};

const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed.";
  if (!ERROR_CODE_PATTERN.test(message)) return message;
  const known = API_ERROR_MESSAGES[message];
  if (known) return known;
  // An unmapped code used to render as a bare "The request could not be
  // completed." — which is how `connection_already_active` (a precise, useful
  // 409) reached a user as a dead end. Carry the code so an unmapped case is
  // diagnosable instead of invisible.
  return `The request could not be completed (${message}).`;
}

/** Exported so a test can assert every code we emit has a human message. */
export const KNOWN_API_ERROR_CODES = Object.keys(API_ERROR_MESSAGES);

/**
 * Codes that never reach a browser: bridge projection, the delivery worker, and
 * connector plumbing. They are deliberately NOT given user copy — writing a
 * sentence for `delivery_terminal` would be writing for nobody. Listed
 * explicitly so a NEW code has to be classified rather than silently falling
 * through to a blank failure, which is how `connection_already_active` reached
 * an owner as "The request could not be completed."
 */
export const INTERNAL_ONLY_ERROR_CODES = [
  "connector_key_invalid",
  "connector_key_mismatch",
  "connector_unavailable",
  "delivery_completion_conflict",
  "delivery_context_invalid",
  "delivery_not_found",
  "delivery_terminal",
  "home_roster_unreadable",
  "message_enqueue_failed",
  "message_ingest_failed",
  "parent_event_invalid",
  "parent_mapping_missing",
  "source_body_invalid",
  "source_event_invalid",
  "wrapping_key_unavailable",
  "wrapping_key_unconfigured",
];
