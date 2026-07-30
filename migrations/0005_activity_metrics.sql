CREATE TABLE community_activity_metrics (
  candidate_id uuid PRIMARY KEY REFERENCES community_candidates(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL DEFAULT now(),
  window_days integer NOT NULL,

  adoption_pubkeys integer NOT NULL DEFAULT 0,
  adoption_repos integer NOT NULL DEFAULT 0,
  adoption_score numeric(5, 2) NOT NULL DEFAULT 0,

  probes_total integer NOT NULL DEFAULT 0,
  probes_successful integer NOT NULL DEFAULT 0,
  liveness_score numeric(5, 2) NOT NULL DEFAULT 0,

  metadata_changed_at timestamptz,
  tending_score numeric(5, 2) NOT NULL DEFAULT 0,

  activity_score numeric(5, 2) NOT NULL DEFAULT 0,
  evidence_sufficient boolean NOT NULL DEFAULT false,

  CONSTRAINT community_activity_metrics_window
    CHECK (window_days > 0 AND window_days <= 365),
  CONSTRAINT community_activity_metrics_counts
    CHECK (
      adoption_pubkeys >= 0
      AND adoption_repos >= 0
      AND probes_total >= 0
      AND probes_successful >= 0
      AND probes_successful <= probes_total
    ),
  CONSTRAINT community_activity_metrics_scores
    CHECK (
      adoption_score BETWEEN 0 AND 100
      AND liveness_score BETWEEN 0 AND 100
      AND tending_score BETWEEN 0 AND 100
      AND activity_score BETWEEN 0 AND 100
    )
);

CREATE INDEX community_activity_metrics_score_idx
  ON community_activity_metrics (activity_score DESC, computed_at DESC);
