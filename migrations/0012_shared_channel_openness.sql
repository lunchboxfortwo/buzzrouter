-- Owners can advertise that their community welcomes shared-channel
-- invitations. The flag is set in the claim workspace and surfaced in the
-- public directory so communities looking to connect can find willing peers.
ALTER TABLE communities
  ADD COLUMN open_to_shared_channels boolean NOT NULL DEFAULT false;
