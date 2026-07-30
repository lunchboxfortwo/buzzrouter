ALTER TABLE probe_snapshots
  ADD COLUMN relay_name text,
  ADD COLUMN relay_description text;

ALTER TABLE probe_snapshots
  ADD CONSTRAINT probe_snapshots_relay_name
    CHECK (relay_name IS NULL OR char_length(relay_name) <= 120),
  ADD CONSTRAINT probe_snapshots_relay_description
    CHECK (
      relay_description IS NULL OR
      char_length(relay_description) <= 1000
    );
