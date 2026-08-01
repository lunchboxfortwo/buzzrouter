-- The in-community BuzzRouter Agent classifies a community's focus from its real
-- activity (see src/presence/summarize.ts + refresh-community-summaries). That is
-- a far stronger signal than the hostname keyword heuristic, so it gets its own
-- focus_source, 'presence', that outranks 'classified' but never a human's
-- 'operator'/'confirmed'. Extend the CHECK to admit it. Drop-then-add so a
-- re-run reconciles idempotently.
ALTER TABLE communities
  DROP CONSTRAINT IF EXISTS communities_focus_source;

ALTER TABLE communities
  ADD CONSTRAINT communities_focus_source
    CHECK (
      focus_source IS NULL OR focus_source IN (
        'classified',
        'operator',
        'confirmed',
        'presence'
      )
    );
