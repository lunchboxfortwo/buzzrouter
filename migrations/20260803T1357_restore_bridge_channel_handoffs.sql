-- Channel creation is a three-step relay handoff: the bridge creates the
-- channel, promotes the community owner, then demotes itself. Persist progress
-- after every acknowledged step so retries resume the same channel instead of
-- leaving a bridge-owned orphan or creating duplicates.
CREATE TABLE IF NOT EXISTS bridge_channel_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL
    REFERENCES community_connections (id) ON DELETE CASCADE,
  community_id uuid NOT NULL
    REFERENCES communities (id) ON DELETE CASCADE,
  requester_pubkey text NOT NULL
    CHECK (requester_pubkey ~ '^[a-f0-9]{64}$'),
  relay_url_snapshot text NOT NULL,
  channel_id text NOT NULL
    CHECK (char_length(channel_id) BETWEEN 1 AND 200),
  channel_name text NOT NULL
    CHECK (char_length(channel_name) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'creating'
    CHECK (state IN ('creating', 'created', 'handed_off', 'completed')),
  idempotency_key text NOT NULL
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  attempts integer NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  last_error text
    CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bridge_channel_handoffs_idempotency
    UNIQUE (connection_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS bridge_channel_handoffs_incomplete_idx
  ON bridge_channel_handoffs (community_id, updated_at)
  WHERE state <> 'completed';
