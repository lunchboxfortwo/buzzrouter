-- The directory advertised a community as joinable whenever we had ANY invite
-- code for it, regardless of whether a claim would actually be accepted. Buzz
-- communities gate joins (an age/ToS handshake, and per-community admission —
-- owner-only / allowlist / anyone), so a harvested code is not proof the join
-- will land. A user tapped "Open in Buzz", the deep link's bare claim was
-- refused (`join_policy_required`), and the client showed a silent spinner.
--
-- This records the OUTCOME of actually probing claimability per candidate, so
-- the directory can only claim "joinable" when a claim genuinely succeeds, can
-- say "request an invite" where admission is restricted, and can DECAY a stale
-- verdict (`probed_at`) since a policy can change and codes expire. `probed_code`
-- pins the verdict to the exact code we probed, so rotating in a fresh invite
-- invalidates a prior verdict instead of inheriting it.
CREATE TABLE IF NOT EXISTS community_join_probes (
  candidate_id uuid PRIMARY KEY
    REFERENCES community_candidates (id) ON DELETE CASCADE,
  -- The invite code that was probed (null when probed without a code, e.g. a
  -- public-URL community). Compared against the currently advertised code so a
  -- code swap invalidates the verdict.
  probed_code text,
  -- open        — a bare claim succeeds; a new user gets in with just the code.
  -- policy_gated — a Buzz ToS/age handshake is required before the claim lands.
  -- restricted   — admission refused (owner-only / allowlist) even so.
  -- stale        — the code is expired/invalid; it no longer admits anyone.
  -- unknown      — transient failure (network/5xx/rate limit); verdict withheld.
  status text NOT NULL
    CHECK (
      status IN ('open', 'policy_gated', 'restricted', 'stale', 'unknown')
    ),
  detail text,
  probed_at timestamptz NOT NULL DEFAULT now()
);

-- Drives the probe job's "what is due to (re)check" query: candidates whose
-- verdict is oldest first.
CREATE INDEX IF NOT EXISTS community_join_probes_probed_at_idx
  ON community_join_probes (probed_at);
