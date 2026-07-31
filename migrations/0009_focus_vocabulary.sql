ALTER TABLE communities
  DROP CONSTRAINT communities_focus;

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
        'team-private',
        'privacy-security',
        'growth-gtm'
      )
    );
