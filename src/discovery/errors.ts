export type DiscoveryErrorCode =
  | "invalid_url"
  | "unsupported_scheme"
  | "embedded_credentials"
  | "invalid_host"
  | "blocked_host"
  | "dns_failed"
  | "dns_no_answers"
  | "blocked_address"
  | "http_timeout"
  | "http_status"
  | "response_too_large"
  | "invalid_nip11"
  | "ws_timeout"
  | "ws_failed";

export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;

  constructor(code: DiscoveryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiscoveryError";
    this.code = code;
  }
}

export function toDiscoveryError(
  error: unknown,
  fallbackCode: DiscoveryErrorCode,
  fallbackMessage: string,
): DiscoveryError {
  if (error instanceof DiscoveryError) {
    return error;
  }

  return new DiscoveryError(fallbackCode, fallbackMessage, {
    cause: error instanceof Error ? error : undefined,
  });
}
