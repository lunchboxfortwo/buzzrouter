DO $$
DECLARE
  identity_count bigint;
  exported_count bigint;
  membership_count bigint;
BEGIN
  -- A literal replay after the tables have been removed is a no-op, not only a
  -- runner-level skip based on the recorded migration filename.
  IF to_regclass('managed_identities') IS NULL
    AND to_regclass('managed_identity_sessions') IS NULL
    AND to_regclass('managed_identity_memberships') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('managed_identities') IS NULL
    OR to_regclass('managed_identity_sessions') IS NULL
    OR to_regclass('managed_identity_memberships') IS NULL THEN
    RAISE EXCEPTION 'Refusing to remove an incomplete managed identity schema';
  END IF;

  -- Keep the production verification and the destructive DDL in one
  -- transaction. The locks prevent a final identity/session/join write from
  -- landing after the counts are checked but before the tables are dropped.
  LOCK TABLE managed_identity_memberships IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE managed_identity_sessions IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE managed_identities IN ACCESS EXCLUSIVE MODE;

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
