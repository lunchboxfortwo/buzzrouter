-- One-time backfill: the BuzzRouter Agent joined buzzdir ad hoc before the
-- presence_communities table existed, so its membership was never recorded.
-- Every future join records itself via the join path; this seeds only that one
-- pre-existing foothold so the 4-hour refresh job picks it up on first deploy.
-- Idempotent and public identifiers only (no secrets, no invite code).
INSERT INTO presence_communities (relay_host, relay_url, community_id, joined_at)
VALUES (
  'buzzdir.communities.buzz.xyz',
  'wss://buzzdir.communities.buzz.xyz',
  'a7eb239c-a29d-4be3-86c5-4179aeecab41',
  now()
)
ON CONFLICT (relay_host) DO NOTHING;
