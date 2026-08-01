-- A short (~40 char) directory-row tagline for a community, distinct from the
-- 1-2 sentence `goals`: the row has room for only a few words, and a truncated
-- sentence tells the reader nothing. The in-community agent's summarizer emits
-- it alongside goals (see src/presence/summarize.ts). Idempotent so a re-run is
-- a no-op.
ALTER TABLE presence_communities
  ADD COLUMN IF NOT EXISTS tagline text;
