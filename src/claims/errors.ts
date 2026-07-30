export type ClaimErrorCode =
  | "authentication_required"
  | "authentication_invalid"
  | "authentication_replayed"
  | "candidate_not_found"
  | "candidate_not_verified"
  | "challenge_expired"
  | "challenge_failed"
  | "challenge_not_found"
  | "claim_conflict"
  | "invalid_input"
  | "proof_not_found";

export class ClaimError extends Error {
  readonly code: ClaimErrorCode;
  readonly status: number;

  constructor(
    code: ClaimErrorCode,
    message: string,
    status = 400,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClaimError";
    this.code = code;
    this.status = status;
  }
}
