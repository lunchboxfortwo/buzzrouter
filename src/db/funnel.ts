import type { Pool } from "pg";

/**
 * Layer-1 funnel: join-affordance click events. This records visitor INTENT
 * (which community/affordance/device), never the join outcome and never PII —
 * outcome measurement needs the relay to report claims, which is a separate,
 * bigger integration. An anonymous first-party `session_id` lets repeated clicks
 * from one visitor collapse into "unique clickers". See
 * `app/api/events/route.ts` (write) and `scripts/funnel-status.ts` (read).
 */

export type FunnelEventType = "join_click";

export interface FunnelEventInput {
  eventType: FunnelEventType;
  candidateId: string | null;
  host: string | null;
  affordance: string | null;
  device: string | null;
  sessionId: string | null;
}

/** Append one funnel event. */
export async function recordFunnelEvent(
  pool: Pool,
  event: FunnelEventInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO funnel_events
       (event_type, candidate_id, host, affordance, device, session_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.eventType,
      event.candidateId,
      event.host,
      event.affordance,
      event.device,
      event.sessionId,
    ],
  );
}

export interface FunnelRollup {
  windowDays: number;
  totalJoinClicks: number;
  uniqueClickers: number;
  byDevice: { device: string; clicks: number; uniqueClickers: number }[];
  byAffordance: { affordance: string; clicks: number }[];
  topCommunities: { host: string; clicks: number; uniqueClickers: number }[];
  byDay: { day: string; clicks: number }[];
}

/**
 * Aggregate join-click events over the last `windowDays`. Reports both raw
 * clicks and `uniqueClickers` (distinct session ids) so one visitor rage-clicking
 * a failing join doesn't read as many interested people. Clicks with no session
 * id (cookie unavailable) count toward clicks but not toward unique.
 */
export async function getFunnelRollup(
  pool: Pool,
  windowDays = 7,
): Promise<FunnelRollup> {
  // `$1 || ' days'` keeps the window a bound parameter, never string-built.
  const since = `created_at >= now() - ($1 || ' days')::interval`;
  const base = `FROM funnel_events WHERE event_type = 'join_click' AND ${since}`;

  const [totals, byDevice, byAffordance, topCommunities, byDay] =
    await Promise.all([
      pool.query<{ n: string; u: string }>(
        `SELECT count(*) AS n, count(DISTINCT session_id) AS u ${base}`,
        [windowDays],
      ),
      pool.query<{ label: string; n: string; u: string }>(
        `SELECT coalesce(device, 'unknown') AS label, count(*) AS n,
                count(DISTINCT session_id) AS u ${base}
         GROUP BY 1 ORDER BY 2 DESC`,
        [windowDays],
      ),
      pool.query<{ label: string; n: string }>(
        `SELECT coalesce(affordance, 'unknown') AS label, count(*) AS n ${base}
         GROUP BY 1 ORDER BY 2 DESC`,
        [windowDays],
      ),
      pool.query<{ label: string; n: string; u: string }>(
        `SELECT coalesce(host, '(none)') AS label, count(*) AS n,
                count(DISTINCT session_id) AS u ${base}
         GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
        [windowDays],
      ),
      pool.query<{ label: string; n: string }>(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS label,
                count(*) AS n ${base}
         GROUP BY 1 ORDER BY 1`,
        [windowDays],
      ),
    ]);

  return {
    byAffordance: byAffordance.rows.map((r) => ({
      affordance: r.label,
      clicks: Number(r.n),
    })),
    byDay: byDay.rows.map((r) => ({ clicks: Number(r.n), day: r.label })),
    byDevice: byDevice.rows.map((r) => ({
      clicks: Number(r.n),
      device: r.label,
      uniqueClickers: Number(r.u),
    })),
    topCommunities: topCommunities.rows.map((r) => ({
      clicks: Number(r.n),
      host: r.label,
      uniqueClickers: Number(r.u),
    })),
    totalJoinClicks: Number(totals.rows[0]?.n ?? 0),
    uniqueClickers: Number(totals.rows[0]?.u ?? 0),
    windowDays,
  };
}
