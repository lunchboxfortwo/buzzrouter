CREATE TABLE communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE
    REFERENCES community_candidates (id) ON DELETE CASCADE,
  slug text UNIQUE,
  visibility text NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal', 'public', 'suppressed')),
  claim_state text NOT NULL DEFAULT 'unclaimed'
    CHECK (
      claim_state IN (
        'unclaimed',
        'admin_verified',
        'provider_verified',
        'disputed'
      )
    ),
  owner_pubkey text,
  display_name text,
  description text,
  categories text[] NOT NULL DEFAULT '{}',
  public_join_mode text NOT NULL DEFAULT 'invite_required'
    CHECK (
      public_join_mode IN (
        'invite_required',
        'request_invite',
        'public_link'
      )
    ),
  public_join_url text,
  listed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communities_slug
    CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  CONSTRAINT communities_owner_pubkey
    CHECK (owner_pubkey IS NULL OR owner_pubkey ~ '^[a-f0-9]{64}$'),
  CONSTRAINT communities_display_name
    CHECK (
      display_name IS NULL OR
      char_length(display_name) BETWEEN 2 AND 80
    ),
  CONSTRAINT communities_description
    CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT communities_categories
    CHECK (cardinality(categories) <= 5),
  CONSTRAINT communities_join_url
    CHECK (
      public_join_url IS NULL OR
      (
        char_length(public_join_url) <= 2048 AND
        public_join_url ~ '^https://'
      )
    ),
  CONSTRAINT communities_public_complete
    CHECK (
      visibility <> 'public' OR
      (
        claim_state IN ('admin_verified', 'provider_verified') AND
        owner_pubkey IS NOT NULL AND
        slug IS NOT NULL AND
        display_name IS NOT NULL AND
        description IS NOT NULL
      )
    )
);

CREATE INDEX communities_public_idx
  ON communities (listed_at DESC, slug)
  WHERE visibility = 'public';

CREATE TABLE claim_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL
    REFERENCES community_candidates (id) ON DELETE CASCADE,
  claimant_pubkey text NOT NULL
    CHECK (claimant_pubkey ~ '^[a-f0-9]{64}$'),
  method text NOT NULL
    CHECK (method IN ('dns_txt', 'http_file', 'hosted_icon')),
  token_hash text NOT NULL
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'expired', 'failed')),
  attempts integer NOT NULL DEFAULT 0
    CHECK (attempts BETWEEN 0 AND 10),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX claim_challenges_pending_idx
  ON claim_challenges (candidate_id, claimant_pubkey)
  WHERE status = 'pending';

CREATE TABLE community_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL
    REFERENCES community_candidates (id) ON DELETE CASCADE,
  claimant_pubkey text NOT NULL
    CHECK (claimant_pubkey ~ '^[a-f0-9]{64}$'),
  method text NOT NULL
    CHECK (method IN ('dns_txt', 'http_file', 'hosted_icon', 'provider')),
  status text NOT NULL
    CHECK (status IN ('verified', 'disputed', 'revoked')),
  challenge_id uuid UNIQUE
    REFERENCES claim_challenges (id) ON DELETE SET NULL,
  proof_summary jsonb NOT NULL DEFAULT '{}',
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX community_claims_candidate_idx
  ON community_claims (candidate_id, status, verified_at DESC);

CREATE TABLE nostr_auth_events (
  id text PRIMARY KEY
    CHECK (id ~ '^[a-f0-9]{64}$'),
  pubkey text NOT NULL
    CHECK (pubkey ~ '^[a-f0-9]{64}$'),
  request_url text NOT NULL,
  request_method text NOT NULL,
  event_created_at timestamptz NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nostr_auth_events_used_idx
  ON nostr_auth_events (used_at);
