// In-memory sliding-window rate limiter for POST /api/submissions.
//
// State lives in this process only. That is acceptable because the app runs
// as a single long-running `next start` web instance, so all submission
// traffic hits the same process and shares these maps. If this ever scales to
// multiple web replicas, move the counters to a shared store (Redis etc.).
//
// Three limits are enforced together on every call:
//   1. Per-IP:  5 requests / 60s
//   2. Per-IP: 20 requests / 3600s (1 hour)
//   3. Global: 30 requests / 60s (all IPs combined)
//
// Only ALLOWED calls are recorded, so a blocked client cannot keep pushing its
// own window forward by hammering the endpoint.

const PER_IP_MINUTE_LIMIT = 5;
const PER_IP_MINUTE_WINDOW_MS = 60_000;
const PER_IP_HOUR_LIMIT = 20;
const PER_IP_HOUR_WINDOW_MS = 3_600_000;
const GLOBAL_MINUTE_LIMIT = 30;
const GLOBAL_MINUTE_WINDOW_MS = 60_000;

// Ascending-sorted request timestamps (ms). Oldest first, so pruning drops
// from the front and the [limit]-th-from-end entry is the binding one.
const perIpTimestamps = new Map<string, number[]>();
const globalTimestamps: number[] = [];

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

// Drop timestamps at or before the window cutoff. Input is ascending, so we
// only need to find the first entry still inside the window. Always returns a
// fresh array so callers can push/replace without aliasing module state.
function pruneBefore(timestamps: number[], cutoff: number): number[] {
  let firstLive = 0;
  while (firstLive < timestamps.length && timestamps[firstLive] <= cutoff) {
    firstLive += 1;
  }
  return timestamps.slice(firstLive);
}

// Seconds until `timestamps` would drop below `limit` entries, i.e. when the
// oldest entry that must expire leaves the window. Ceil to whole seconds,
// min 1. Assumes the window is currently full (length >= limit).
function retryAfterFor(
  timestamps: number[],
  limit: number,
  windowMs: number,
  now: number,
): number {
  // The entry that must expire to free a slot is the one `limit` from the end;
  // once it leaves the window (its time + windowMs) a new request fits.
  const bindingTimestamp = timestamps[timestamps.length - limit];
  const freeAt = bindingTimestamp + windowMs;
  return Math.max(1, Math.ceil((freeAt - now) / 1_000));
}

export function checkSubmissionRateLimit(
  ip: string,
  now: number = Date.now(),
): RateLimitResult {
  // The hour list is the master per-IP list; the minute list is its suffix
  // (shorter window), so derive the minute list from the pruned hour list.
  const ipHourPruned = pruneBefore(
    perIpTimestamps.get(ip) ?? [],
    now - PER_IP_HOUR_WINDOW_MS,
  );
  const ipMinutePruned = pruneBefore(
    ipHourPruned,
    now - PER_IP_MINUTE_WINDOW_MS,
  );
  const global = pruneBefore(globalTimestamps, now - GLOBAL_MINUTE_WINDOW_MS);

  const retries: number[] = [];
  if (ipMinutePruned.length >= PER_IP_MINUTE_LIMIT) {
    retries.push(
      retryAfterFor(
        ipMinutePruned,
        PER_IP_MINUTE_LIMIT,
        PER_IP_MINUTE_WINDOW_MS,
        now,
      ),
    );
  }
  if (ipHourPruned.length >= PER_IP_HOUR_LIMIT) {
    retries.push(
      retryAfterFor(ipHourPruned, PER_IP_HOUR_LIMIT, PER_IP_HOUR_WINDOW_MS, now),
    );
  }
  if (global.length >= GLOBAL_MINUTE_LIMIT) {
    retries.push(
      retryAfterFor(global, GLOBAL_MINUTE_LIMIT, GLOBAL_MINUTE_WINDOW_MS, now),
    );
  }

  if (retries.length > 0) {
    // Persist the pruned lists even on denial so the maps don't grow unbounded,
    // but do NOT append this request — a denied call is not recorded.
    if (ipHourPruned.length > 0) {
      perIpTimestamps.set(ip, ipHourPruned);
    } else {
      perIpTimestamps.delete(ip);
    }
    replaceGlobal(global);
    return {
      allowed: false,
      retryAfterSeconds: Math.min(...retries),
    };
  }

  // Allowed: record the request against every window.
  ipHourPruned.push(now);
  perIpTimestamps.set(ip, ipHourPruned);
  global.push(now);
  replaceGlobal(global);
  return { allowed: true };
}

// Swap the module-level global array contents in place (it is a const binding).
function replaceGlobal(next: number[]): void {
  globalTimestamps.length = 0;
  for (const timestamp of next) {
    globalTimestamps.push(timestamp);
  }
}

// Clear all in-memory counters. Intended for test isolation.
export function resetRateLimitState(): void {
  perIpTimestamps.clear();
  globalTimestamps.length = 0;
}
