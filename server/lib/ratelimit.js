import { config } from './config.js';

const buckets = new Map();

// Fixed-window counter per client IP. Enough to stop a single visitor from
// burning the shared Instagram rate budget for everyone else.
export function rateLimit(key) {
  const now = Date.now();
  const windowMs = config.rateLimitWindowSeconds * 1000;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: config.rateLimitMax - 1, resetInSeconds: config.rateLimitWindowSeconds };
  }

  bucket.count += 1;
  const resetInSeconds = Math.ceil((bucket.resetAt - now) / 1000);

  return {
    allowed: bucket.count <= config.rateLimitMax,
    remaining: Math.max(0, config.rateLimitMax - bucket.count),
    resetInSeconds,
  };
}

// Keep the map from growing without bound on a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();
