-- A dedicated channel the bridge CREATES for one shared-channel link (kind 9007)
-- and then hands to the human who asked for the link (kind 9000: promote them,
-- demote the bot). Creation and handoff are two relay round trips, so the bot
-- can end up owning a channel in someone else's community if the handoff fails
-- between them. This table persists the in-flight handoff so it can be RESUMED:
-- each row records how far the sequence got (`state`) and enough to retry the
-- remaining steps against the same channel id.
--
-- Timestamp-prefixed per migrations/README.md (the old sequential counter is a
-- shared mutable resource). Idempotent (IF NOT EXISTS throughout) as a belt-and-
-- suspenders no-op on any re-run — see AGENTS.md "Migrations & the deploy gate".
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
  -- creating  : row reserved, kind-9007 not yet confirmed on the relay
  -- created   : channel exists, bot is its owner — NOT yet handed off (danger)
  -- handed_off: requester promoted to owner, bot not yet stepped down
  -- completed : bot demoted to member — terminal success
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
  -- One handoff per (requester, idempotency key): a retried request resumes the
  -- same row instead of creating a second channel.
  CONSTRAINT bridge_channel_handoffs_idempotency
    UNIQUE (requester_pubkey, idempotency_key)
);

-- Find handoffs stuck mid-sequence for a community (retry surface / diagnostics).
CREATE INDEX IF NOT EXISTS bridge_channel_handoffs_incomplete_idx
  ON bridge_channel_handoffs (community_id, updated_at)
  WHERE state <> 'completed';
