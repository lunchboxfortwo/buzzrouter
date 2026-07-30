CREATE TABLE community_icons (
  candidate_id uuid PRIMARY KEY
    REFERENCES community_candidates(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  image_bytes bytea NOT NULL,
  content_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_icons_content_type
    CHECK (
      content_type IN (
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp'
      )
    ),
  CONSTRAINT community_icons_size
    CHECK (octet_length(image_bytes) BETWEEN 1 AND 262144),
  CONSTRAINT community_icons_content_hash
    CHECK (content_hash ~ '^[a-f0-9]{64}$')
);
