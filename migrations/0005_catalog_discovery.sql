ALTER TABLE community_sources
  DROP CONSTRAINT community_sources_source_type_check;

ALTER TABLE community_sources
  ADD CONSTRAINT community_sources_source_type_check
    CHECK (
      source_type IN (
        'reviewed_seed',
        'github',
        'nip65',
        'nip66',
        'provider',
        'manual',
        'buzzdir',
        'submission'
      )
    );

ALTER TABLE community_sources
  ADD COLUMN source_display_name text,
  ADD COLUMN source_description text,
  ADD COLUMN source_categories text[] NOT NULL DEFAULT '{}';

ALTER TABLE community_sources
  ADD CONSTRAINT community_sources_display_name
    CHECK (
      source_display_name IS NULL OR
      char_length(source_display_name) BETWEEN 2 AND 80
    ),
  ADD CONSTRAINT community_sources_description
    CHECK (
      source_description IS NULL OR
      char_length(source_description) <= 500
    ),
  ADD CONSTRAINT community_sources_categories
    CHECK (
      cardinality(source_categories) <= 5 AND
      source_categories <@ ARRAY[
        'bitcoin',
        'builders',
        'culture',
        'gtm',
        'labs',
        'privacy'
      ]::text[]
    );
