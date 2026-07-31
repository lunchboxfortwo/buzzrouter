CREATE TABLE community_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL UNIQUE
    REFERENCES communities (id) ON DELETE CASCADE,
  relay_url_snapshot text NOT NULL,
  bridge_pubkey text NOT NULL
    CHECK (bridge_pubkey ~ '^[a-f0-9]{64}$'),
  encrypted_private_key bytea NOT NULL,
  private_key_nonce bytea NOT NULL
    CHECK (octet_length(private_key_nonce) = 12),
  private_key_auth_tag bytea NOT NULL
    CHECK (octet_length(private_key_auth_tag) = 16),
  wrapping_key_version integer NOT NULL
    CHECK (wrapping_key_version > 0),
  state text NOT NULL DEFAULT 'installing'
    CHECK (state IN ('installing', 'active', 'revoked', 'failed')),
  health text NOT NULL DEFAULT 'pending'
    CHECK (
      health IN (
        'pending',
        'healthy',
        'degraded',
        'unauthorized',
        'unreachable',
        'credential_error'
      )
    ),
  last_health_error text,
  last_health_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_connections_relay_url
    CHECK (
      relay_url_snapshot ~
      '^wss://(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$'
    ),
  CONSTRAINT community_connections_health_error
    CHECK (
      last_health_error IS NULL OR
      char_length(last_health_error) <= 500
    ),
  CONSTRAINT community_connections_revoked_at
    CHECK (
      (state = 'revoked' AND revoked_at IS NOT NULL) OR
      (state <> 'revoked' AND revoked_at IS NULL)
    )
);

CREATE INDEX community_connections_active_idx
  ON community_connections (state, updated_at)
  WHERE state IN ('installing', 'active');

CREATE TABLE connection_install_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL
    REFERENCES communities (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  owner_pubkey text NOT NULL
    CHECK (owner_pubkey ~ '^[a-f0-9]{64}$'),
  bridge_pubkey text NOT NULL
    CHECK (bridge_pubkey ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'consumed', 'expired', 'failed')),
  attempts integer NOT NULL DEFAULT 0
    CHECK (attempts BETWEEN 0 AND 10),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  activation_receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connection_install_tokens_consumed
    CHECK (
      (state = 'consumed' AND consumed_at IS NOT NULL) OR
      (state <> 'consumed' AND consumed_at IS NULL)
    )
);

CREATE UNIQUE INDEX connection_install_tokens_pending_idx
  ON connection_install_tokens (community_id)
  WHERE state = 'pending';

CREATE INDEX connection_install_tokens_expiry_idx
  ON connection_install_tokens (expires_at)
  WHERE state = 'pending';

CREATE TABLE shared_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_by_community_id uuid NOT NULL
    REFERENCES communities (id) ON DELETE RESTRICT,
  proposed_name text NOT NULL,
  purpose text NOT NULL,
  state text NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed', 'active', 'rejected', 'disconnected')),
  created_by text NOT NULL
    CHECK (created_by ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  disconnected_by text,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shared_channels_name
    CHECK (char_length(proposed_name) BETWEEN 1 AND 80),
  CONSTRAINT shared_channels_purpose
    CHECK (char_length(purpose) BETWEEN 1 AND 500),
  CONSTRAINT shared_channels_rejected_by
    CHECK (rejected_by IS NULL OR rejected_by ~ '^[a-f0-9]{64}$'),
  CONSTRAINT shared_channels_disconnected_by
    CHECK (disconnected_by IS NULL OR disconnected_by ~ '^[a-f0-9]{64}$'),
  CONSTRAINT shared_channels_rejected_state
    CHECK (
      (
        state = 'rejected' AND
        rejected_by IS NOT NULL AND
        rejected_at IS NOT NULL
      ) OR
      (
        state <> 'rejected' AND
        rejected_by IS NULL AND
        rejected_at IS NULL
      )
    ),
  CONSTRAINT shared_channels_disconnected_state
    CHECK (
      (
        state = 'disconnected' AND
        disconnected_by IS NOT NULL AND
        disconnected_at IS NOT NULL
      ) OR
      (
        state <> 'disconnected' AND
        disconnected_by IS NULL AND
        disconnected_at IS NULL
      )
    )
);

CREATE TABLE shared_channel_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_channel_id uuid NOT NULL
    REFERENCES shared_channels (id) ON DELETE CASCADE,
  community_id uuid NOT NULL
    REFERENCES communities (id) ON DELETE RESTRICT,
  connection_id uuid
    REFERENCES community_connections (id) ON DELETE RESTRICT,
  role text NOT NULL
    CHECK (role IN ('source', 'destination')),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'active', 'paused', 'disconnected')),
  relay_url_snapshot text,
  local_channel_id text,
  local_channel_name_snapshot text,
  accepted_by text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shared_channel_id, community_id),
  UNIQUE (shared_channel_id, role),
  CONSTRAINT shared_channel_endpoints_relay_url
    CHECK (
      relay_url_snapshot IS NULL OR
      relay_url_snapshot ~
      '^wss://(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$'
    ),
  CONSTRAINT shared_channel_endpoints_channel_id
    CHECK (
      local_channel_id IS NULL OR
      char_length(local_channel_id) BETWEEN 1 AND 200
    ),
  CONSTRAINT shared_channel_endpoints_channel_name
    CHECK (
      local_channel_name_snapshot IS NULL OR
      char_length(local_channel_name_snapshot) BETWEEN 1 AND 80
    ),
  CONSTRAINT shared_channel_endpoints_accepted_by
    CHECK (accepted_by IS NULL OR accepted_by ~ '^[a-f0-9]{64}$'),
  CONSTRAINT shared_channel_endpoints_active_complete
    CHECK (
      state = 'pending' OR
      state = 'disconnected' OR
      (
        connection_id IS NOT NULL AND
        relay_url_snapshot IS NOT NULL AND
        local_channel_id IS NOT NULL AND
        local_channel_name_snapshot IS NOT NULL AND
        accepted_by IS NOT NULL AND
        accepted_at IS NOT NULL
      )
    )
);

CREATE INDEX shared_channel_endpoints_community_idx
  ON shared_channel_endpoints (community_id, state, updated_at DESC);

CREATE INDEX shared_channels_invitation_idx
  ON shared_channels (state, created_at DESC)
  WHERE state = 'proposed';

CREATE TABLE bridge_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_channel_id uuid NOT NULL
    REFERENCES shared_channels (id) ON DELETE CASCADE,
  source_endpoint_id uuid NOT NULL
    REFERENCES shared_channel_endpoints (id) ON DELETE CASCADE,
  source_event_id text NOT NULL
    CHECK (source_event_id ~ '^[a-f0-9]{64}$'),
  source_actor_pubkey text NOT NULL
    CHECK (source_actor_pubkey ~ '^[a-f0-9]{64}$'),
  source_signed_event jsonb,
  source_parent_event_id text,
  parent_bridge_message_id uuid
    REFERENCES bridge_messages (id) ON DELETE SET NULL,
  body text,
  body_sha256 text NOT NULL
    CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  content_expires_at timestamptz NOT NULL
    DEFAULT (now() + interval '7 days'),
  UNIQUE (shared_channel_id, source_endpoint_id, source_event_id),
  CONSTRAINT bridge_messages_parent_event
    CHECK (
      source_parent_event_id IS NULL OR
      source_parent_event_id ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT bridge_messages_body_size
    CHECK (
      body IS NULL OR
      octet_length(convert_to(body, 'UTF8')) BETWEEN 1 AND 16384
    )
);

CREATE TABLE bridge_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_message_id uuid NOT NULL
    REFERENCES bridge_messages (id) ON DELETE CASCADE,
  destination_endpoint_id uuid NOT NULL
    REFERENCES shared_channel_endpoints (id) ON DELETE CASCADE,
  destination_signed_event jsonb,
  destination_event_id text,
  state text NOT NULL DEFAULT 'queued'
    CHECK (
      state IN (
        'queued',
        'delivering',
        'retry',
        'delivered_to_relay',
        'failed',
        'cancelled'
      )
    ),
  attempts integer NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  terminal_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (destination_endpoint_id, bridge_message_id),
  CONSTRAINT bridge_deliveries_event_id
    CHECK (
      destination_event_id IS NULL OR
      destination_event_id ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT bridge_deliveries_terminal_error
    CHECK (
      terminal_error_code IS NULL OR
      char_length(terminal_error_code) <= 80
    )
);

CREATE INDEX bridge_deliveries_due_idx
  ON bridge_deliveries (next_attempt_at, id)
  WHERE state IN ('queued', 'retry');

CREATE TABLE bridge_event_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_channel_id uuid NOT NULL
    REFERENCES shared_channels (id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL
    REFERENCES shared_channel_endpoints (id) ON DELETE CASCADE,
  bridge_message_id uuid NOT NULL
    REFERENCES bridge_messages (id) ON DELETE CASCADE,
  local_event_id text NOT NULL
    CHECK (local_event_id ~ '^[a-f0-9]{64}$'),
  local_parent_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, bridge_message_id),
  UNIQUE (endpoint_id, local_event_id),
  CONSTRAINT bridge_event_mappings_parent
    CHECK (
      local_parent_event_id IS NULL OR
      local_parent_event_id ~ '^[a-f0-9]{64}$'
    )
);

CREATE TABLE shared_channel_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_channel_id uuid
    REFERENCES shared_channels (id) ON DELETE SET NULL,
  community_id uuid NOT NULL
    REFERENCES communities (id) ON DELETE RESTRICT,
  actor_pubkey text NOT NULL
    CHECK (actor_pubkey ~ '^[a-f0-9]{64}$'),
  action text NOT NULL,
  target_id uuid,
  previous_state text,
  next_state text,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shared_channel_audit_action
    CHECK (char_length(action) BETWEEN 1 AND 80),
  CONSTRAINT shared_channel_audit_idempotency
    CHECK (
      idempotency_key IS NULL OR
      char_length(idempotency_key) BETWEEN 8 AND 200
    )
);

CREATE UNIQUE INDEX shared_channel_audit_idempotency_idx
  ON shared_channel_audit_events (actor_pubkey, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX shared_channel_audit_target_idx
  ON shared_channel_audit_events (shared_channel_id, created_at DESC);
