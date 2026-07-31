CREATE TABLE community_reliability_metrics (
  candidate_id uuid PRIMARY KEY REFERENCES community_candidates(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL DEFAULT now(),
  window_days integer NOT NULL,

  adoption_pubkeys integer NOT NULL DEFAULT 0,
  adoption_repos integer NOT NULL DEFAULT 0,
  adoption_score numeric(5, 2) NOT NULL DEFAULT 0,

  probes_total integer NOT NULL DEFAULT 0,
  probes_successful integer NOT NULL DEFAULT 0,
  uptime_score numeric(5, 2) NOT NULL DEFAULT 0,

  metadata_changed_at timestamptz,
  tending_score numeric(5, 2) NOT NULL DEFAULT 0,

  corroboration_sources integer NOT NULL DEFAULT 0,
  corroboration_score numeric(5, 2) NOT NULL DEFAULT 0,

  reliability_score numeric(5, 2) NOT NULL DEFAULT 0,
  evidence_sufficient boolean NOT NULL DEFAULT false,

  CONSTRAINT community_reliability_metrics_window
    CHECK (window_days > 0 AND window_days <= 365),
  CONSTRAINT community_reliability_metrics_counts
    CHECK (
      adoption_pubkeys >= 0
      AND adoption_repos >= 0
      AND probes_total >= 0
      AND probes_successful >= 0
      AND probes_successful <= probes_total
      AND corroboration_sources >= 0
    ),
  CONSTRAINT community_reliability_metrics_scores
    CHECK (
      adoption_score BETWEEN 0 AND 100
      AND uptime_score BETWEEN 0 AND 100
      AND tending_score BETWEEN 0 AND 100
      AND corroboration_score BETWEEN 0 AND 100
      AND reliability_score BETWEEN 0 AND 100
    )
);

CREATE INDEX community_reliability_metrics_score_idx
  ON community_reliability_metrics (reliability_score DESC, computed_at DESC);
