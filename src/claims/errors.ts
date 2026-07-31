import { ApiError } from "../http/api-error";

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

export class ClaimError extends ApiError {
  declare readonly code: ClaimErrorCode;

  constructor(
    code: ClaimErrorCode,
    message: string,
    status = 400,
    options?: ErrorOptions,
  ) {
    super(code, message, status, options);
    this.name = "ClaimError";
  }
}
