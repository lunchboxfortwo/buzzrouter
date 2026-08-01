-- Backs the synchronous invite-submission validation flow. The public submit
-- route inserts a `pending` row here and then polls it for a terminal result;
-- a worker atomically claims a batch (FOR UPDATE SKIP LOCKED), joins the invite
-- code against the relay to validate it, and writes back the outcome
-- (`valid`/`invalid`/`error`) plus an optional `candidate_id` and message. The
-- partial index on pending rows keeps the worker's claim scan cheap as resolved
-- rows accumulate.
--
-- Idempotent (IF NOT EXISTS throughout) because the deploy gate re-applies every
-- migration in the deploying revision; the reconciling re-run must be a no-op.
CREATE TABLE IF NOT EXISTS submission_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relay_host text NOT NULL,
  relay_url text NOT NULL,
  invite_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','valid','invalid','error')),
  candidate_id uuid,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS submission_validations_pending_idx
  ON submission_validations (created_at) WHERE status = 'pending';
