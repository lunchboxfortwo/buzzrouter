-- One bounce notice per source event, forever.
--
-- A message that is deliberately NOT routed is never ingested, so it never
-- advances `shared_channel_endpoints.last_event_created_at` — and the connector
-- re-subscribes with `since = min(last_event_created_at)` on every idle
-- rebuild, so the relay replays that same event again and again. Every other
-- effect of reading a source event is already idempotent by source event id
-- (`bridge_messages`' UNIQUE (shared_channel_id, source_endpoint_id,
-- source_event_id)); posting a notice was the one that was not, and it posted
-- one notice per rebuild into a live channel until the feature was reverted.
--
-- This row is that missing idempotency key. It is claimed BEFORE the notice is
-- published, so a crash in between drops a notice rather than repeating one,
-- and it is durable so restarts and replicas cannot each post their own.
CREATE TABLE IF NOT EXISTS bridge_undeliverable_notices (
  source_endpoint_id uuid NOT NULL
    REFERENCES shared_channel_endpoints (id) ON DELETE CASCADE,
  source_event_id text NOT NULL
    CHECK (source_event_id ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL
    CHECK (reason IN ('unknown-destination', 'unknown-user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_endpoint_id, source_event_id)
);
