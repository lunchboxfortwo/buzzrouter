-- The open BuzzRouter channel is the existing shared-channel model with many
-- bidirectional participant endpoints. A following migration removes the
-- superseded directional proposal/confirmation model completely.
ALTER TABLE shared_channels
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'bilateral';

ALTER TABLE shared_channels
  DROP CONSTRAINT IF EXISTS shared_channels_mode;

ALTER TABLE shared_channels
  ADD CONSTRAINT shared_channels_mode
  CHECK (mode IN ('bilateral', 'hub'));

CREATE UNIQUE INDEX IF NOT EXISTS shared_channels_single_hub_idx
  ON shared_channels (mode)
  WHERE mode = 'hub';

ALTER TABLE shared_channel_endpoints
  DROP CONSTRAINT IF EXISTS shared_channel_endpoints_role_check;

ALTER TABLE shared_channel_endpoints
  ADD CONSTRAINT shared_channel_endpoints_role_check
  CHECK (role IN ('source', 'destination', 'participant'));

ALTER TABLE shared_channel_endpoints
  DROP CONSTRAINT IF EXISTS shared_channel_endpoints_shared_channel_id_role_key;

CREATE UNIQUE INDEX IF NOT EXISTS shared_channel_endpoints_bilateral_role_idx
  ON shared_channel_endpoints (shared_channel_id, role)
  WHERE role IN ('source', 'destination');

ALTER TABLE shared_channel_endpoints
  ADD COLUMN IF NOT EXISTS sends boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS receives boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS filter_mode text NOT NULL DEFAULT 'everyone_except',
  ADD COLUMN IF NOT EXISTS filter_list uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE shared_channel_endpoints
  DROP CONSTRAINT IF EXISTS shared_channel_endpoints_filter_mode;

ALTER TABLE shared_channel_endpoints
  ADD CONSTRAINT shared_channel_endpoints_filter_mode
  CHECK (filter_mode IN ('everyone_except', 'only_these'));

ALTER TABLE bridge_messages
  ADD COLUMN IF NOT EXISTS source_actor_name text;

ALTER TABLE bridge_messages
  DROP CONSTRAINT IF EXISTS bridge_messages_actor_name;

ALTER TABLE bridge_messages
  ADD CONSTRAINT bridge_messages_actor_name
  CHECK (
    source_actor_name IS NULL OR
    char_length(source_actor_name) BETWEEN 1 AND 80
  );

CREATE INDEX IF NOT EXISTS bridge_deliveries_source_outcomes_idx
  ON bridge_deliveries (bridge_message_id, state, updated_at DESC);
