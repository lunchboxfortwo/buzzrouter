// Generic in-memory sliding-window rate limiter for the managed-identity
// endpoints. Kept separate from src/http/rate-limit.ts (which is hardcoded to
// the submission limits) so identity creation and joins get their own buckets
// without reworking that module.
//
// State lives in this process only — acceptable for a single `next start` web
// instance, same caveat as src/http/rate-limit.ts. Move to a shared store if
// this ever runs on multiple replicas.
//
// The limits below exist so we are not an abuse amplifier against other
// people's communities: upstream caps invite claims at 10/60s per pubkey, so
// our per-identity join limit sits well under that, and per-IP + global caps
// stop one client fanning claims across many identities.

export interface RateLimitRule {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

// Ascending-sorted request timestamps (ms) per composite bucket key. Oldest
// first, so pruning drops from the front.
const buckets = new Map<string, number[]>();

function bucketKey(rule: RateLimitRule): string {
  return `${rule.windowMs}:${rule.limit}:${rule.key}`;
}

function pruneBefore(timestamps: number[], cutoff: number): number[] {
  let firstLive = 0;
  while (firstLive < timestamps.length && timestamps[firstLive] <= cutoff) {
    firstLive += 1;
  }
  return firstLive === 0 ? timestamps : timestamps.slice(firstLive);
}

function retryAfterFor(
  timestamps: number[],
  limit: number,
  windowMs: number,
  now: number,
): number {
  const bindingTimestamp = timestamps[timestamps.length - limit];
  return Math.max(1, Math.ceil((bindingTimestamp + windowMs - now) / 1_000));
}

/**
 * Check a set of sliding-window rules together. A request is allowed only if
 * every rule has room; on denial it returns the longest retry-after across the
 * blocking rules. Nothing is recorded on denial, so a blocked client cannot
 * keep pushing its own window forward by hammering the endpoint. Only when ALL
 * rules pass is the request appended to each bucket.
 */
export function checkRateLimit(
  rules: RateLimitRule[],
  now: number = Date.now(),
): RateLimitResult {
  const pruned = rules.map((rule) => ({
    rule,
    timestamps: pruneBefore(buckets.get(bucketKey(rule)) ?? [], now - rule.windowMs),
  }));

  const retries: number[] = [];
  for (const { rule, timestamps } of pruned) {
    if (timestamps.length >= rule.limit) {
      retries.push(retryAfterFor(timestamps, rule.limit, rule.windowMs, now));
    }
  }

  // Persist pruned lists either way so the maps do not grow unbounded.
  for (const { rule, timestamps } of pruned) {
    if (timestamps.length > 0) {
      buckets.set(bucketKey(rule), timestamps);
    } else {
      buckets.delete(bucketKey(rule));
    }
  }

  if (retries.length > 0) {
    return { allowed: false, retryAfterSeconds: Math.min(...retries) };
  }

  for (const { rule, timestamps } of pruned) {
    timestamps.push(now);
    buckets.set(bucketKey(rule), timestamps);
  }
  return { allowed: true };
}

/** Clear all counters. Intended for test isolation. */
export function resetManagedIdentityRateLimits(): void {
  buckets.clear();
}
