-- Extends the community_sources source_type CHECK to allow 'harvest': invites
-- harvested from channel messages of communities the BuzzRouter Agent is NOT yet
-- a member of are now ingested as directory candidates (source type 'harvest',
-- code in source_invite_code) so the discovery/probe/verification pipeline vets
-- them before they are ever joined or displayed, instead of being direct-joined.
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
        'submission',
        'harvest'
      )
    );
