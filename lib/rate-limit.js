// lib/rate-limit.js
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/**
 * Increment a counter in Redis with expiry (fixed window).
 * Returns: { count, ttl }
 */
export async function incrWithExpire(key, windowSeconds) {
  // Use a Lua script for atomic INCR + EXPIRE only-if-not-set.
  // Upstash supports EVAL, but we can use multi transaction for simple atomicity.
  const res = await redis.multi()
    .incr(key)
    .ttl(key)
    .exec()

  // res format: [{result: newCount}, {result: ttl}]
  let count = res[0].result
  let ttl = res[1].result

  if (ttl === -1 || ttl === -2) {
    // If no TTL, set expiry to windowSeconds
    await redis.expire(key, windowSeconds)
    ttl = windowSeconds
  }

  return { count, ttl }
}

/**
 * Check rate limit, possibly increment on failure.
 * - key: redis key
 * - limit: allowed attempts
 * - window: seconds
 *
 * Returns: { allowed: boolean, remaining: number, retryAfter: number }
 */
export async function checkAndIncrement(key, limit, windowSeconds, incrementOnCheck = false) {
  // If incrementOnCheck is true this call will immediately increment (useful to charge attempts).
  // We'll use separate flows: check first; increment on failure.
  // But for atomic combine, you can set incrementOnCheck true.

  if (incrementOnCheck) {
    const { count, ttl } = await incrWithExpire(key, windowSeconds)
    const allowed = count <= limit
    const remaining = allowed ? (limit - count) : 0
    const retryAfter = allowed ? 0 : ttl
    return { allowed, remaining, retryAfter, count, ttl }
  } else {
    const count = await redis.get(key) || 0
    const ttl = await redis.ttl(key)
    const allowed = Number(count) < limit
    const remaining = Math.max(0, limit - Number(count))
    const retryAfter = allowed ? 0 : (ttl > 0 ? ttl : windowSeconds)
    return { allowed, remaining, retryAfter, count: Number(count), ttl }
  }
}

/**
 * Increment a failure counter and return current state.
 */
export async function recordFailure(key, windowSeconds) {
  const { count, ttl } = await incrWithExpire(key, windowSeconds)
  const retryAfter = ttl || windowSeconds
  return { count, retryAfter }
}

/**
 * Reset counters (on successful sign-in).
 */
export async function resetKey(key) {
  await redis.del(key)
}
