import "server-only";

/**
 * Fixed-window rate limiter. In-memory store is per server instance, which is fine
 * for dev; production swaps in Upstash Redis (UPSTASH_REDIS_REST_URL) — see D-011.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 10_000) sweep(now);
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  entry.count += 1;
  return { ok: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
}

function sweep(now: number) {
  for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
