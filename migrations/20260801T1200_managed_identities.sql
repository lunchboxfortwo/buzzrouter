-- Managed Nostr identities: BuzzRouter holds the key so a visitor can join
-- communities without owning a key, installing anything, or understanding
-- Nostr. The custody threat model is identical to the connector bridge key
-- (community_connections): the secret is AES-256-GCM sealed with a host
-- wrapping key that lives in a root-owned file, NEVER in Postgres. Only the
-- ciphertext, nonce, and auth tag land here. See src/managed-identity/store.ts.
--
-- Every statement is idempotent (IF NOT EXISTS) so a filename-keyed re-run is a
-- clean no-op, per the migration runner's contract.

CREATE TABLE IF NOT EXISTS managed_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The public key (hex) this identity acts as. Public; also the GCM AAD that
  -- binds the ciphertext to this identity.
  pubkey text NOT NULL UNIQUE,
  -- AES-256-GCM sealed secret key. Same column shape as community_connections.
  encrypted_private_key bytea NOT NULL,
  private_key_nonce bytea NOT NULL,
  private_key_auth_tag bytea NOT NULL,
  wrapping_key_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set the first time the raw nsec is revealed for export, so the UI can tell
  -- the user honestly that a copy of the key now exists outside our custody.
  exported_at timestamptz
);

-- A durable, opaque bearer token (stored only as its sha256) is how a visitor
-- comes back to the same managed identity from the same browser. Many sessions
-- per identity so a user can return from more than one device.
CREATE TABLE IF NOT EXISTS managed_identity_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL
    REFERENCES managed_identities (id) ON DELETE CASCADE,
  session_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS managed_identity_sessions_identity_idx
  ON managed_identity_sessions (identity_id);

-- Which communities this identity has joined, so click-to-join is idempotent
-- (we never re-claim upstream for a community already joined) and the UI can
-- show real "Joined" state. One row per (identity, relay host).
CREATE TABLE IF NOT EXISTS managed_identity_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL
    REFERENCES managed_identities (id) ON DELETE CASCADE,
  relay_host text NOT NULL,
  community_id text,
  role text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_id, relay_host)
);

CREATE INDEX IF NOT EXISTS managed_identity_memberships_identity_idx
  ON managed_identity_memberships (identity_id);
