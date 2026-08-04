-- BuzzRouter gets one dedicated channel per connected community instead of
-- taking every peer's traffic into the single shared `general` channel.
--
-- The hub is one `shared_channels` row with one endpoint per community, and
-- `UNIQUE (shared_channel_id, community_id)` made that literal: BuzzRouter, as
-- one community, could hold exactly one endpoint and therefore exactly one
-- channel. `dedicated_to_community_id` names the peer an endpoint exists to
-- talk to, so one community can now hold its ordinary hub endpoint plus one
-- dedicated endpoint per peer. NULL is the ordinary endpoint every participant
-- already has; nothing about an existing row changes.
ALTER TABLE shared_channel_endpoints
  ADD COLUMN IF NOT EXISTS dedicated_to_community_id uuid
    REFERENCES communities (id) ON DELETE RESTRICT;

ALTER TABLE shared_channel_endpoints
  DROP CONSTRAINT IF EXISTS shared_channel_endpoints_shared_channel_id_community_id_key;

ALTER TABLE shared_channel_endpoints
  DROP CONSTRAINT IF EXISTS shared_channel_endpoints_dedicated_peer;

ALTER TABLE shared_channel_endpoints
  ADD CONSTRAINT shared_channel_endpoints_dedicated_peer
  CHECK (
    dedicated_to_community_id IS NULL OR
    dedicated_to_community_id <> community_id
  );

-- One ordinary endpoint per community per shared channel: the old constraint,
-- unchanged, for every row that is not dedicated to a peer.
CREATE UNIQUE INDEX IF NOT EXISTS shared_channel_endpoints_general_idx
  ON shared_channel_endpoints (shared_channel_id, community_id)
  WHERE dedicated_to_community_id IS NULL;

-- At most one dedicated endpoint per (owner community, peer community).
CREATE UNIQUE INDEX IF NOT EXISTS shared_channel_endpoints_dedicated_idx
  ON shared_channel_endpoints (
    shared_channel_id,
    community_id,
    dedicated_to_community_id
  )
  WHERE dedicated_to_community_id IS NOT NULL;
