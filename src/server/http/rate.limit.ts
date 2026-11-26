/** Fixed-window limits (per window). */
export const RATE_WINDOW_MS = 60_000;
/** Sign-in/OAuth callback requests per client IP per window. */
export const AUTH_LIMIT_PER_IP = 10;
/** Mutating /api/panel and /api/dev requests per session per window. */
export const MUTATION_LIMIT_PER_SESSION = 60;

/** Expired windows are swept once this many keys are tracked (bounds memory under an IP flood). */
const SWEEP_AT_KEYS = 10_000;
const MS_PER_SEC = 1000;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Client IP: CF-Connecting-IP only when the TCP peer is loopback (cloudflared on the phone sets it and
 * the panel listens on 127.0.0.1 only); otherwise the socket address, so the header cannot be spoofed.
 */
export function clientIp(headers: Headers, remoteAddress: string | null): string {
  const peer = remoteAddress ?? "unknown";
  const cf = headers.get("cf-connecting-ip")?.trim();
  return cf && LOOPBACK.has(peer) ? cf : peer;
}

/** In-memory fixed-window counter. `take(key)` → null when allowed, else seconds until the window resets. */
export function createRateLimiter(limit: number, windowMs = RATE_WINDOW_MS, clock: () => number = Date.now) {
  // ponytail: in-memory, single process; fine for one panel binary, a shared store only if it ever scales out.
  const hits = new Map<string, { start: number; n: number }>();
  return {
    take(key: string): number | null {
      const now = clock();
      let w = hits.get(key);
      if (!w || now - w.start >= windowMs) {
        if (hits.size > SWEEP_AT_KEYS) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        w = { start: now, n: 0 };
        hits.set(key, w);
      }
      w.n++;
      return w.n > limit ? Math.max(1, Math.ceil((w.start + windowMs - now) / MS_PER_SEC)) : null;
    },
  };
}

/** Rate limiter instance type. */
export type RateLimiter = ReturnType<typeof createRateLimiter>;
