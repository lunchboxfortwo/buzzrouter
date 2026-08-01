-- Extends the community_sources source_type CHECK to allow 'x': invite links
-- discovered from public X (Twitter) posts via recent search. New hosts are
-- ingested as directory candidates (source type 'x', code in source_invite_code);
-- hosts the agent already joined go to harvested_invite_candidates as spares
-- (same split as in-community harvest).
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
        'harvest',
        'x'
      )
    );
