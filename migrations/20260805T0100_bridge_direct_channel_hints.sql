-- One "you can /open a direct channel" hint per (inbox, source community), ever.
--
-- When a community's message lands in a peer's INBOX (not a dedicated channel),
-- the peer has no direct channel with that community yet. The bridge posts a
-- one-time hint into the inbox so the receiver learns `/open <community>`
-- exists. Without it, `/open` works but is undiscoverable.
--
-- Same replay hazard as bridge_undeliverable_notices / bridge_command_receipts:
-- delivery is idempotent per bridge_delivery, but this key makes the hint fire
-- exactly once per (inbox endpoint, source community) across retries, restarts,
-- and multiple replicas. Claimed BEFORE the hint is published, so the failure
-- mode is a dropped hint, never a repeated one.
CREATE TABLE IF NOT EXISTS bridge_direct_channel_hints (
  destination_endpoint_id uuid NOT NULL
    REFERENCES shared_channel_endpoints (id) ON DELETE CASCADE,
  source_community_id uuid NOT NULL
    REFERENCES communities (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (destination_endpoint_id, source_community_id)
);
