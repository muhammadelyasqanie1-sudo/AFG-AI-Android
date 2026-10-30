/**
 * In-memory sliding-window rate limiter. Good enough for a single Render
 * instance; swap for Redis when running multiple instances.
 */
export function createRateLimiter({ now = () => Date.now(), maxBuckets = 10000 } = {}) {
  const buckets = new Map();

  function hit(key, limit, windowMs) {
    const timestamp = now();
    let bucket = buckets.get(key);
    if (!bucket || timestamp - bucket.start >= windowMs) {
      bucket = { start: timestamp, count: 0 };
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    if (buckets.size > maxBuckets) {
      for (const [bucketKey, value] of buckets) {
        if (timestamp - value.start > windowMs) buckets.delete(bucketKey);
      }
    }

    const remaining = Math.max(0, limit - bucket.count);
    const retryAfter = Math.max(1, Math.ceil((bucket.start + windowMs - timestamp) / 1000));
    return { limited: bucket.count > limit, remaining, retryAfter };
  }

  return {
    hit,
    reset(key) {
      buckets.delete(key);
    },
    size: () => buckets.size
  };
}

export function clientKey(req, identity) {
  if (identity?.userId) return "u:" + identity.userId;
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || ""))
    .split(",")[0]
    .trim();
  return "ip:" + (ip || req.socket?.remoteAddress || "unknown");
}
