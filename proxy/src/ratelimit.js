/* Per-visitor sliding-window rate limit.
 *
 * In-memory Map<key, {count, windowStart}>. Window = 60 s. Per-project
 * cap from config. Suitable for a single-instance proxy; if you scale
 * horizontally swap for Redis-backed counters.
 */

const WINDOW_MS = 60_000;

/** @type {Map<string, {count: number, windowStart: number}>} */
const buckets = new Map();

/**
 * @param {string} key — typically `${projectKey}:${visitorId}`
 * @param {number} limit — per-minute cap
 * @returns {{ok: boolean, retryInMs: number}}
 */
export function take(key, limit) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.windowStart >= WINDOW_MS) {
    b = { count: 0, windowStart: now };
    buckets.set(key, b);
  }
  if (b.count >= limit) {
    return { ok: false, retryInMs: Math.max(0, WINDOW_MS - (now - b.windowStart)) };
  }
  b.count += 1;
  return { ok: true, retryInMs: 0 };
}

/** Drop entries with stale windows so the Map doesn't grow forever. */
export function sweep() {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart >= WINDOW_MS * 2) buckets.delete(k);
  }
}

// Light periodic sweep; cheap, runs once a minute.
setInterval(sweep, WINDOW_MS).unref();
