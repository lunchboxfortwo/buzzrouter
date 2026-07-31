-- Fresh invite codes harvested from channel messages of communities the
-- BuzzRouter Agent is ALREADY a member of. When a member posts a new invite for
-- a community we're already in, we record the code as a candidate here so a
-- later phase (gated on the health-check spike) can swap a stale live invite for
-- a fresh one. This table only COLLECTS candidates; nothing here swaps a live
-- invite. One row per (relay_host, code); `seen_at` is bumped on re-harvest.
CREATE TABLE harvested_invite_candidates (
  relay_host text NOT NULL,
  code text NOT NULL,
  -- The community whose channel the invite was harvested from (a member may
  -- post community A's invite inside community B), for provenance/debugging.
  source_relay_host text,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (relay_host, code)
);
