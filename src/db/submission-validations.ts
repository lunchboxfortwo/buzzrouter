import type { Pool } from "pg";

/**
 * Persistence for the synchronous invite-submission validation flow (table
 * `submission_validations`). The public submit route inserts a `pending` row and
 * polls it for a terminal status; a worker atomically claims a batch, validates
 * the invite against its relay, and writes back the result. Rows are a durable
 * hand-off between the web request and the worker — no secret material is stored,
 * only the relay host/url, the invite code, and the validation outcome.
 */

export interface CreateSubmissionValidationInput {
  relayHost: string;
  relayUrl: string;
  inviteCode: string;
}

/**
 * Inserts a fresh `pending` validation row for the worker to pick up and returns
 * its generated id, which the web route polls with `getSubmissionValidation`.
 */
export async function createSubmissionValidation(
  pool: Pool,
  input: CreateSubmissionValidationInput,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO submission_validations (relay_host, relay_url, invite_code)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [input.relayHost, input.relayUrl, input.inviteCode],
  );
  return result.rows[0]!.id;
}

export interface SubmissionValidationResult {
  status: string;
  candidateId: string | null;
  message: string | null;
}

/**
 * Reads the current status of a validation row (used by the web route to poll),
 * or null when no row matches the id.
 */
export async function getSubmissionValidation(
  pool: Pool,
  id: string,
): Promise<SubmissionValidationResult | null> {
  const result = await pool.query<{
    status: string;
    candidate_id: string | null;
    message: string | null;
  }>(
    `
      SELECT status, candidate_id, message
      FROM submission_validations
      WHERE id = $1
    `,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    candidateId: row.candidate_id,
    message: row.message,
    status: row.status,
  };
}

export interface ClaimedSubmissionValidation {
  id: string;
  relayHost: string;
  relayUrl: string;
  inviteCode: string;
}

/**
 * Atomically claims up to `limit` pending rows by flipping them to `processing`,
 * using FOR UPDATE SKIP LOCKED so concurrent workers never grab the same row.
 * Returns the claimed rows in the camelCase shape the worker consumes.
 */
export async function claimPendingValidations(
  pool: Pool,
  limit: number,
): Promise<ClaimedSubmissionValidation[]> {
  const result = await pool.query<{
    id: string;
    relay_host: string;
    relay_url: string;
    invite_code: string;
  }>(
    `
      UPDATE submission_validations SET status = 'processing'
      WHERE id IN (
        SELECT id FROM submission_validations WHERE status = 'pending'
        ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, relay_host, relay_url, invite_code
    `,
    [limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    inviteCode: row.invite_code,
    relayHost: row.relay_host,
    relayUrl: row.relay_url,
  }));
}

export interface ResolveSubmissionValidationResult {
  status: "valid" | "invalid" | "error";
  candidateId?: string | null;
  message?: string | null;
}

/**
 * Writes the terminal outcome of a claimed validation and stamps `resolved_at`,
 * which the polling web route observes as a completed result.
 */
export async function resolveSubmissionValidation(
  pool: Pool,
  id: string,
  result: ResolveSubmissionValidationResult,
): Promise<void> {
  await pool.query(
    `
      UPDATE submission_validations
      SET status = $2,
          candidate_id = $3,
          message = $4,
          resolved_at = now()
      WHERE id = $1
    `,
    [id, result.status, result.candidateId ?? null, result.message ?? null],
  );
}
