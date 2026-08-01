-- Signer-free owner sessions for the mobile "Link" flow.
--
-- On mobile there is no NIP-07 browser signer, so an owner cannot sign the
-- NIP-98 requests the shared-channel write path normally requires. Instead they
-- paste an invite link from their Buzz app; the bridge redeems it itself (proof
-- an admin wanted a member admitted) and, once the connection is active, we mint
-- a short-lived, community-scoped session credential. That session stands in for
-- the owner signature on the follow-up "Connect with the BuzzRouter community"
-- action ONLY — the actual binding still requires the relay-signed roster code
-- typed into the chosen channel (shared_channel_confirmations), which remains the
-- real authority. The session grants nothing on its own and expires fast.
--
-- Every statement is idempotent (IF NOT EXISTS) so a filename-keyed re-run is a
-- clean no-op, per the migration runner's contract.
CREATE TABLE IF NOT EXISTS connection_owner_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL
    REFERENCES communities (id) ON DELETE CASCADE,
  -- The community's recorded verified owner pubkey, snapshotted at mint time so
  -- the session acts strictly as that owner for that one community.
  owner_pubkey text NOT NULL,
  -- sha256 of the opaque bearer token; the raw token is returned once and never
  -- stored, mirroring connection_install_tokens.
  session_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connection_owner_sessions_community_idx
  ON connection_owner_sessions (community_id);
