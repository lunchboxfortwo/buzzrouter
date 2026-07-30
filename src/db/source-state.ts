import type { Pool } from "pg";

export interface SourceCursor {
  [key: string]: boolean | number | string | null | SourceCursor;
}

export interface SourceRunResult {
  candidatesAccepted: number;
  candidatesIgnored: number;
  eventsRead?: number;
  pagesRead?: number;
}

export async function getSourceCursor<T extends SourceCursor>(
  pool: Pool,
  sourceKey: string,
  fallback: T,
): Promise<T> {
  const result = await pool.query<{ cursor: T }>(
    `
      SELECT cursor
      FROM discovery_source_state
      WHERE source_key = $1
    `,
    [sourceKey],
  );

  return result.rows[0]?.cursor ?? fallback;
}

export async function recordSourceSuccess(
  pool: Pool,
  sourceKey: string,
  cursor: SourceCursor,
  result: SourceRunResult,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO discovery_source_state (
        source_key,
        cursor,
        last_run_at,
        last_success_at,
        last_error_code,
        last_result
      )
      VALUES ($1, $2::jsonb, now(), now(), NULL, $3::jsonb)
      ON CONFLICT (source_key) DO UPDATE
        SET cursor = EXCLUDED.cursor,
            last_run_at = EXCLUDED.last_run_at,
            last_success_at = EXCLUDED.last_success_at,
            last_error_code = NULL,
            last_result = EXCLUDED.last_result,
            updated_at = now()
    `,
    [sourceKey, JSON.stringify(cursor), JSON.stringify(result)],
  );
}

export async function recordSourceFailure(
  pool: Pool,
  sourceKey: string,
  errorCode: string,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO discovery_source_state (
        source_key,
        last_run_at,
        last_error_code
      )
      VALUES ($1, now(), $2)
      ON CONFLICT (source_key) DO UPDATE
        SET last_run_at = EXCLUDED.last_run_at,
            last_error_code = EXCLUDED.last_error_code,
            updated_at = now()
    `,
    [sourceKey, errorCode],
  );
}
