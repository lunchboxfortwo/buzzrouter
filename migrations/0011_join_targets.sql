-- Reverses the earlier no-invite-storage policy at the operator's direction.
-- Invite codes and public join URLs from the public catalog are now retained
-- so the directory can hand a joinable target to the Buzz app. The
-- source_locator no-invite constraint stays: codes live in their own labelled,
-- auditable column rather than hidden inside a locator string.
ALTER TABLE community_sources
  ADD COLUMN source_public_url text,
  ADD COLUMN source_invite_code text;

ALTER TABLE community_sources
  ADD CONSTRAINT community_sources_public_url
    CHECK (
      source_public_url IS NULL OR source_public_url ~* '^https://'
    ),
  ADD CONSTRAINT community_sources_invite_code
    CHECK (
      source_invite_code IS NULL OR char_length(source_invite_code) BETWEEN 1 AND 200
    );
