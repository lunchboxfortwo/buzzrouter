-- Bilateral routes are no longer a separate mechanism. A private pair is one
-- hub participant using filter_mode='only_these' with one community selected.
-- Production has never had an endpoint, but remove any non-hub rows explicitly
-- so the schema cannot preserve or recreate the retired consent flow.
DELETE FROM shared_channels WHERE mode <> 'hub';

DROP TABLE IF EXISTS shared_channel_confirmations;
DROP TABLE IF EXISTS bridge_channel_handoffs;
DROP TABLE IF EXISTS shared_channel_audit_events;

DROP INDEX IF EXISTS shared_channel_endpoints_bilateral_role_idx;
DROP INDEX IF EXISTS shared_channels_invitation_idx;

ALTER TABLE shared_channels
  DROP CONSTRAINT IF EXISTS shared_channels_name,
  DROP CONSTRAINT IF EXISTS shared_channels_purpose,
  DROP CONSTRAINT IF EXISTS shared_channels_rejected_by,
  DROP CONSTRAINT IF EXISTS shared_channels_disconnected_by,
  DROP CONSTRAINT IF EXISTS shared_channels_rejected_state,
  DROP CONSTRAINT IF EXISTS shared_channels_disconnected_state,
  DROP CONSTRAINT IF EXISTS shared_channels_state_check;

ALTER TABLE shared_channels
  DROP COLUMN IF EXISTS proposed_by_community_id,
  DROP COLUMN IF EXISTS proposed_name,
  DROP COLUMN IF EXISTS purpose,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS rejected_by,
  DROP COLUMN IF EXISTS rejected_at,
  DROP COLUMN IF EXISTS disconnected_by,
  DROP COLUMN IF EXISTS disconnected_at;

ALTER TABLE shared_channels
  ALTER COLUMN state SET DEFAULT 'active';

ALTER TABLE shared_channels
  ADD CONSTRAINT shared_channels_state_check CHECK (state = 'active');

ALTER TABLE shared_channel_endpoints
  DROP CONSTRAINT IF EXISTS shared_channel_endpoints_role_check;

ALTER TABLE shared_channel_endpoints
  ADD CONSTRAINT shared_channel_endpoints_role_check
  CHECK (role = 'participant');

ALTER TABLE shared_channel_endpoints
  DROP CONSTRAINT IF EXISTS shared_channel_endpoints_accepted_by,
  DROP CONSTRAINT IF EXISTS shared_channel_endpoints_active_complete,
  DROP CONSTRAINT IF EXISTS shared_channel_endpoints_state_check;

ALTER TABLE shared_channel_endpoints
  DROP COLUMN IF EXISTS accepted_by,
  DROP COLUMN IF EXISTS accepted_at;

ALTER TABLE shared_channel_endpoints
  ALTER COLUMN state SET DEFAULT 'active';

ALTER TABLE shared_channel_endpoints
  ADD CONSTRAINT shared_channel_endpoints_state_check CHECK (state = 'active'),
  ADD CONSTRAINT shared_channel_endpoints_active_complete CHECK (
    connection_id IS NOT NULL AND
    relay_url_snapshot IS NOT NULL AND
    local_channel_id IS NOT NULL AND
    local_channel_name_snapshot IS NOT NULL
  );

ALTER TABLE shared_channels
  ALTER COLUMN mode SET DEFAULT 'hub';

ALTER TABLE shared_channels
  DROP CONSTRAINT IF EXISTS shared_channels_mode;

ALTER TABLE shared_channels
  ADD CONSTRAINT shared_channels_mode
  CHECK (mode = 'hub');
