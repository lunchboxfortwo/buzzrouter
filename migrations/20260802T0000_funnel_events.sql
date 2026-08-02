-- Layer-1 funnel instrumentation: append-only click events from the directory's
-- join affordances. Captures INTENT — which community/affordance was clicked, on
-- which device — not the join OUTCOME, which happens on the relay outside our
-- system. Anonymous and aggregate: no user identity, no PII.
--
-- Idempotent (IF NOT EXISTS throughout) because the deploy gate re-applies every
-- migration in the deploying revision; the reconciling re-run must be a no-op.
CREATE TABLE IF NOT EXISTS funnel_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  candidate_id uuid,
  host text,
  affordance text,
  device text,
  -- Anonymous, first-party random id (no PII, not cross-site) so repeated clicks
  -- from one visitor can be de-duplicated into "unique clickers".
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnel_events_created_at_idx
  ON funnel_events (created_at);

CREATE INDEX IF NOT EXISTS funnel_events_host_created_idx
  ON funnel_events (host, created_at);
