-- One execution (and one reply) per slash-command source event, forever.
--
-- A `/`-command is an ordinary kind-9 message the bridge intercepts before
-- routing and never ingests. Because it is never ingested it never advances
-- `shared_channel_endpoints.last_event_created_at`, and the connector
-- re-subscribes with `since = min(last_event_created_at)` on every idle
-- rebuild — so the relay replays the same command event again and again. That
-- is the exact replay that posted ~20 undeliverable notices into a live channel
-- before `bridge_undeliverable_notices` gave the bounce an idempotency key.
--
-- This row is that key for commands: claimed BEFORE the command runs, so a
-- replayed command neither re-runs the handoff nor reposts its reply, and a
-- crash between claim and reply drops the command (the user retypes) rather than
-- repeating it. Durable so a restart or a second replica cannot each run it.
CREATE TABLE IF NOT EXISTS bridge_command_receipts (
  source_endpoint_id uuid NOT NULL
    REFERENCES shared_channel_endpoints (id) ON DELETE CASCADE,
  source_event_id text NOT NULL
    CHECK (source_event_id ~ '^[a-f0-9]{64}$'),
  verb text NOT NULL
    CHECK (verb IN ('open', 'close', 'list', 'usage')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_endpoint_id, source_event_id)
);
