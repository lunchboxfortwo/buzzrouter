CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE community_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_relay_url text NOT NULL UNIQUE,
  host text NOT NULL,
  state text NOT NULL DEFAULT 'discovered'
    CHECK (
      state IN (
        'discovered',
        'probing',
        'verified_buzz',
        'probable_buzz',
        'rejected',
        'suppressed'
      )
    ),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  next_probe_at timestamptz NOT NULL DEFAULT now(),
  classifier_version integer,
  classifier_reason text,
  CONSTRAINT community_candidates_origin_only
    CHECK (
      canonical_relay_url ~
      '^wss://(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$'
    ),
  CONSTRAINT community_candidates_no_credentials
    CHECK (canonical_relay_url !~ '@')
);

CREATE INDEX community_candidates_probe_due_idx
  ON community_candidates (next_probe_at)
  WHERE state <> 'suppressed';

CREATE TABLE community_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id uuid NOT NULL
    REFERENCES community_candidates (id) ON DELETE CASCADE,
  source_type text NOT NULL
    CHECK (
      source_type IN (
        'reviewed_seed',
        'github',
        'nip65',
        'nip66',
        'provider',
        'manual'
      )
    ),
  source_locator text,
  source_actor_pubkey text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  evidence_hash text NOT NULL,
  CONSTRAINT community_sources_no_invites
    CHECK (
      source_locator IS NULL OR
      source_locator !~* '(/invite/|[?&](code|invite)=)'
    ),
  UNIQUE (candidate_id, source_type, evidence_hash)
);

CREATE INDEX community_sources_candidate_idx
  ON community_sources (candidate_id);

CREATE TABLE probe_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id uuid NOT NULL
    REFERENCES community_candidates (id) ON DELETE CASCADE,
  probed_at timestamptz NOT NULL DEFAULT now(),
  http_status integer,
  ws_open_ms integer,
  tls_valid boolean NOT NULL DEFAULT false,
  software text,
  software_version text,
  supported_nips jsonb NOT NULL DEFAULT '[]'::jsonb,
  relay_self_pubkey text,
  auth_required boolean,
  restricted_writes boolean,
  icon_hash text,
  result_code text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX probe_snapshots_candidate_time_idx
  ON probe_snapshots (candidate_id, probed_at DESC);
