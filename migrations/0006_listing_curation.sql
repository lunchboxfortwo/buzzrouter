ALTER TABLE communities
  ADD COLUMN focus text,
  ADD COLUMN display_name_override text,
  ADD COLUMN curated_at timestamptz,
  ADD COLUMN curated_by text;

ALTER TABLE communities
  ADD CONSTRAINT communities_focus
    CHECK (
      focus IS NULL OR focus IN (
        'building',
        'ai-agents',
        'bitcoin-money',
        'design-creative',
        'research-knowledge',
        'local-regional',
        'team-private'
      )
    ),
  ADD CONSTRAINT communities_display_name_override
    CHECK (
      display_name_override IS NULL OR
      char_length(display_name_override) <= 120
    );
