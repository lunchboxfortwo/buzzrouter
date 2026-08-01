-- The submit form previously collected only a relay URL, then presented three
-- policy dt/dd notes as if they were the page's content. This adds the fields
-- other people actually need to care about a community: a contact email (so
-- BuzzRouter can reach the submitter) and a short audience blurb ("who is this
-- for"). Display name, description, and categories already have homes on
-- community_sources (source_display_name/source_description/source_categories,
-- 0005_catalog_discovery.sql); focus reuses the same vocabulary as
-- communities.focus (0008/0009_focus_vocabulary.sql) but communities rows don't
-- exist until claim, so a submitter's chosen focus is staged here first.
ALTER TABLE community_sources
  ADD COLUMN source_contact_email text,
  ADD COLUMN source_audience text,
  ADD COLUMN source_focus text;

ALTER TABLE community_sources
  ADD CONSTRAINT community_sources_contact_email
    CHECK (
      source_contact_email IS NULL OR
      (
        char_length(source_contact_email) <= 254 AND
        source_contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      )
    ),
  ADD CONSTRAINT community_sources_audience
    CHECK (
      source_audience IS NULL OR char_length(source_audience) <= 300
    ),
  ADD CONSTRAINT community_sources_focus
    CHECK (
      source_focus IS NULL OR source_focus IN (
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
