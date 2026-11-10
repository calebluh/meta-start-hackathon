/**
 * Small in-memory rate limits for the server endpoints. The site is public
 * and every call spends the owner's API credits, so each endpoint limits how
 * often one address may call it, and how often it may be called in total.
 *
 * The counts live in the server process. A host that runs several instances,
 * or restarts one, counts separately in each: this slows abuse down, it is
 * not an exact quota.
 */

export interface Limiter {
  /** True if this call is allowed; it then counts against the limit. */
  allow(key: string): boolean;
}

/** At most `max` calls per `windowMs` for each key. */
export function createLimiter(max: number, windowMs: number): Limiter {
  const recent = new Map<string, number[]>();
  return {
    allow(key) {
      const now = Date.now();
      const times = (recent.get(key) ?? []).filter((t) => now - t < windowMs);
      if (times.length >= max) {
        recent.set(key, times);
        return false;
      }
      times.push(now);
      recent.set(key, times);
      if (recent.size > 5000) recent.clear(); // never grow without bound
      return true;
    },
  };
}

/** Every limiter must allow the call. Earlier ones are charged even if a later one refuses. */
export function allowAll(key: string, ...limiters: Limiter[]): boolean {
  return limiters.every((l) => l.allow(key));
}

/**
 * The caller's address behind a proxy. Vercel sets `x-forwarded-for` itself
 * and overwrites anything the caller sent, so it can be trusted there.
 */
export function callerAddress(forwardedFor: string | string[] | null | undefined, fallback = 'unknown'): string {
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return value?.split(',')[0]?.trim() || fallback;
}
