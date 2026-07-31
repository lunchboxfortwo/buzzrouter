-- Two-step shared-channel binding: the destination owner arms a pending
-- endpoint (picks a local channel, gets a one-time code) and the bridge only
-- activates the route once it hears that code typed into the chosen channel by a
-- pubkey the community's relay-signed roster marks owner/admin. The web click
-- alone is a POINTER; authority to bind lives in the counterparty's own roster.
CREATE TABLE shared_channel_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_channel_id uuid NOT NULL
    REFERENCES shared_channels (id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL
    REFERENCES shared_channel_endpoints (id) ON DELETE CASCADE,
  community_id uuid NOT NULL
    REFERENCES communities (id) ON DELETE RESTRICT,
  connection_id uuid NOT NULL
    REFERENCES community_connections (id) ON DELETE RESTRICT,
  local_channel_id text NOT NULL,
  local_channel_name_snapshot text NOT NULL,
  -- Short-lived, single-use nonce. Stored in plaintext because the bridge must
  -- match it against chat content it reads from the relay; it grants nothing on
  -- its own (the roster check is the actual authorization) and expires fast.
  code text NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'consumed')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_pubkey text,
  consumed_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shared_channel_confirmations_channel_id
    CHECK (char_length(local_channel_id) BETWEEN 1 AND 200),
  CONSTRAINT shared_channel_confirmations_channel_name
    CHECK (char_length(local_channel_name_snapshot) BETWEEN 1 AND 80),
  CONSTRAINT shared_channel_confirmations_code
    CHECK (char_length(code) BETWEEN 6 AND 64),
  CONSTRAINT shared_channel_confirmations_consumed_by
    CHECK (
      consumed_by_pubkey IS NULL OR
      consumed_by_pubkey ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT shared_channel_confirmations_consumed_event
    CHECK (
      consumed_event_id IS NULL OR
      consumed_event_id ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT shared_channel_confirmations_consumed_state
    CHECK (
      (
        state = 'consumed' AND
        consumed_at IS NOT NULL AND
        consumed_by_pubkey IS NOT NULL
      ) OR
      (
        state <> 'consumed' AND
        consumed_at IS NULL AND
        consumed_by_pubkey IS NULL AND
        consumed_event_id IS NULL
      )
    )
);

-- At most one live code per endpoint; re-arming replaces the previous one.
CREATE UNIQUE INDEX shared_channel_confirmations_pending_idx
  ON shared_channel_confirmations (endpoint_id)
  WHERE state = 'pending';

-- The connector loads live codes by the connection it already holds open.
CREATE INDEX shared_channel_confirmations_connection_idx
  ON shared_channel_confirmations (connection_id)
  WHERE state = 'pending';
