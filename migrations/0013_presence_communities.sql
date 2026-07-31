-- Records the communities the BuzzRouter Agent has JOINED (via an invite claim)
-- and caches the latest directory-facing summary for each. One row per relay
-- host; `joined_at` is set once at first join and preserved on re-join, while
-- the summary columns are refreshed on a recurring schedule by the presence
-- refresh job. Only public, non-identifying summary material is stored here.
CREATE TABLE presence_communities (
  relay_host text PRIMARY KEY,
  relay_url text NOT NULL,
  community_id uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_summarized_at timestamptz,

  goals text,
  recent_projects jsonb,
  activity_level text,
  active_member_count int,
  total_member_count int,
  message_count int,
  channel_count int,
  window_days int
);
