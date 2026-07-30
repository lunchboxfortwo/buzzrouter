CREATE TABLE discovery_source_state (
  source_key text PRIMARY KEY,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_source_state_key
    CHECK (source_key ~ '^[a-z0-9][a-z0-9._-]{0,127}$')
);

ALTER TABLE community_sources
  ADD COLUMN source_observed_at timestamptz;

UPDATE community_sources
SET source_observed_at = last_seen_at;

ALTER TABLE community_sources
  ALTER COLUMN source_observed_at SET NOT NULL,
  ALTER COLUMN source_observed_at SET DEFAULT now();

CREATE INDEX community_sources_type_actor_idx
  ON community_sources (source_type, source_actor_pubkey)
  WHERE source_actor_pubkey IS NOT NULL;

CREATE INDEX community_sources_candidate_type_idx
  ON community_sources (candidate_id, source_type);
