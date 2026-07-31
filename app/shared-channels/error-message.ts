const API_ERROR_MESSAGES: Record<string, string> = {
  authentication_invalid: "The signed request was not accepted.",
  connection_required: "The community connector must be active first.",
  connector_package_unavailable:
    "The connector package is temporarily unavailable. Try again shortly.",
  destination_not_verified: "The destination community is not verified.",
  install_token_unavailable:
    "That install command has expired or was already used. Request a new one.",
  shared_channel_failed:
    "The shared-channel request could not be completed.",
};

const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed.";
  if (!ERROR_CODE_PATTERN.test(message)) return message;
  return API_ERROR_MESSAGES[message] ?? "The request could not be completed.";
}
