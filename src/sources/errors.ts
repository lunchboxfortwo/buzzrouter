export type SourceErrorCode =
  | "disabled"
  | "invalid_configuration"
  | "rate_limited"
  | "incomplete_results"
  | "remote_failed";

export class SourceAdapterError extends Error {
  readonly code: SourceErrorCode;

  constructor(code: SourceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SourceAdapterError";
    this.code = code;
  }
}
