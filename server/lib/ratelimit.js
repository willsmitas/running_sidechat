import { tooMany } from './errors.js';

// Simple in-memory sliding-window limiter. Good enough for a single process;
// swap for Redis if the app is ever scaled horizontally.
const buckets = new Map();

export function hit(key, limit, windowMs) {
  const now = Date.now();
  let arr = buckets.get(key);
  if (!arr) buckets.set(key, (arr = []));
  while (arr.length && arr[0] <= now - windowMs) arr.shift();
  if (arr.length >= limit) {
    const retryAfter = Math.ceil((arr[0] + windowMs - now) / 1000);
    const err = tooMany(`Slow down — try again in ${formatWait(retryAfter)}.`);
    err.retryAfter = retryAfter;
    throw err;
  }
  arr.push(now);
}

function formatWait(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  return `${Math.ceil(s / 3600)} hr`;
}

export function resetLimits() {
  buckets.clear();
}

setInterval(() => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [k, arr] of buckets) if (!arr.length || arr[arr.length - 1] < cutoff) buckets.delete(k);
}, 10 * 60 * 1000).unref();
