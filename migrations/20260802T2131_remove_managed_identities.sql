-- Keep the production verification and the destructive DDL in one transaction.
-- The locks prevent a final identity/session/join write from landing after the
-- counts are checked but before the tables are dropped.
LOCK TABLE managed_identity_memberships IN ACCESS EXCLUSIVE MODE;
LOCK TABLE managed_identity_sessions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE managed_identities IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  identity_count bigint;
  exported_count bigint;
  membership_count bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE exported_at IS NOT NULL)
  INTO identity_count, exported_count
  FROM managed_identities;

  SELECT count(*)
  INTO membership_count
  FROM managed_identity_memberships;

  IF exported_count <> 0 OR NOT (
    (identity_count = 0 AND membership_count = 0)
    OR (identity_count = 2 AND membership_count = 1)
  ) THEN
    RAISE EXCEPTION
      'Refusing to remove managed identities: found % identities, % memberships, % exports',
      identity_count,
      membership_count,
      exported_count;
  END IF;
END
$$;

DROP TABLE IF EXISTS managed_identity_memberships;
DROP TABLE IF EXISTS managed_identity_sessions;
DROP TABLE IF EXISTS managed_identities;
