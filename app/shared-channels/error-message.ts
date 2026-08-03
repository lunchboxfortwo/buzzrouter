const API_ERROR_MESSAGES: Record<string, string> = {
  authentication_invalid: "The signed request was not accepted.",
  channel_already_routed:
    "That channel is already connected to the hub. Pick a different channel.",
  connection_required: "The community connector must be active first.",
  connector_package_unavailable:
    "The connector package is temporarily unavailable. Try again shortly.",
  connector_round_trip_failed:
    "The bot isn’t admitted to your community yet. Make sure you added it, then try again.",
  install_token_unavailable:
    "That connection session has expired or was already used. Request a new one.",
  invite_claim_rejected:
    "Your relay rejected that invite. Check it hasn’t expired or run out of uses, then paste a fresh one.",
  invite_claim_unreachable:
    "We couldn’t reach your community’s relay to redeem the invite. Try again shortly.",
  invite_host_mismatch:
    "That invite link is for a different relay than this community.",
  invite_invalid: "That doesn’t look like a valid Buzz invite link.",
  shared_channel_failed:
    "The hub connection could not be completed.",
};

const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed.";
  if (!ERROR_CODE_PATTERN.test(message)) return message;
  return API_ERROR_MESSAGES[message] ?? "The request could not be completed.";
}
