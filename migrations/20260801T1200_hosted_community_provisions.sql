-- Resumable state for the one-page "Create a community" flow.
--
-- The flow provisions a hosted Buzz (Builderlab) account, binds a self-generated
-- Nostr key to it, and creates a community owned by that key — all in one
-- server-side session (see src/hosted-signup/). Because the account is
-- effectively WRITE-ONCE (returning login is gated by an email-OTP we cannot
-- read), a failure AFTER the account exists must never orphan it: this table
-- persists the encrypted identity key BEFORE the irreversible bind and the
-- encrypted session credential, so a retry can resume create/list without
-- re-driving signup, as long as the ~8h session is still valid.
--
-- The Nostr secret and the session credential are stored ONLY as AES-256-GCM
-- ciphertext (same wrapping-key scheme as community_connections' custody in
-- src/shared-channels/store.ts); neither is ever written in plaintext.
--
-- Every statement is idempotent (IF NOT EXISTS) so a filename-keyed re-run is a
-- clean no-op, per the migration runner's contract.
CREATE TABLE IF NOT EXISTS hosted_community_provisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The requested community name (lowercase dash-joined) and the handover email
  -- the requester gave us. The email is used only to reach them afterwards.
  community_name text NOT NULL,
  contact_email text NOT NULL,
  -- The self-generated identity that owns the community. bind_pubkey is unique so
  -- persist-before-bind is an idempotent upsert keyed by the identity.
  bind_pubkey text NOT NULL UNIQUE,
  npub text NOT NULL,
  -- AES-256-GCM custody of the identity secret key (AAD = bind_pubkey).
  encrypted_secret bytea NOT NULL,
  secret_nonce bytea NOT NULL,
  secret_auth_tag bytea NOT NULL,
  -- AES-256-GCM custody of the Builderlab session credential (AAD = bind_pubkey),
  -- persisted so a post-bind failure can resume within the session's lifetime.
  -- Nulled out once the community is created (the session is no longer needed).
  encrypted_session bytea,
  session_nonce bytea,
  session_auth_tag bytea,
  session_expires_at timestamptz,
  wrapping_key_version integer NOT NULL,
  -- Builderlab identifiers, set only once the community actually exists.
  community_id text,
  normalized_host text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'created', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hosted_community_provisions_name_status_idx
  ON hosted_community_provisions (community_name, status);
