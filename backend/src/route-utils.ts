import { rateLimit, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';

export const isTest = process.env.NODE_ENV === 'test' || !!process.env.TEST_DATABASE_URL;

/** Middleware this module produced, tagged so a guard can recognize it. */
export type TaggedLimiter = ((req: Request, res: Response, next: () => void) => void) & {
  [RATE_LIMITED]?: true;
};

/**
 * Marks a middleware as "this is the rate limiter", so
 * `rate-limit-coverage.test.ts` can assert every route carries one without
 * depending on what express-rate-limit's instance happens to look like.
 */
export const RATE_LIMITED = Symbol.for('spellcontrol.rateLimited');

/**
 * The rate limiter every `/api` route mounts.
 *
 * Always a real express-rate-limit instance. Tests are exempted per request via
 * `skip` rather than by swapping the middleware for a passthrough, which is the
 * same behaviour by a better route:
 *
 *   - `skip` is evaluated before the key generator and before any store write
 *     (see express-rate-limit's `index.cjs`), so a test still accumulates no
 *     counter state between cases — the entire reason the old branch existed.
 *   - CodeQL's `js/missing-rate-limiting` follows the value that flows into the
 *     route. A ternary returning either `rateLimit(...)` or a bare `next()` lost
 *     it, so the query flagged every route on every router that used one: ~99
 *     instances dismissed as false positives by 2026-09-21, three more on every
 *     PR that touched a router. A check that is wrong every time stops being
 *     read and starts being dismissed on reflex, and the first true positive
 *     gets dismissed with it. Now the query sees a `rateLimit()` and stays
 *     useful for a route that genuinely ships unlimited.
 *
 * Production is unchanged: `isTest` is false there, so `skip` always returns
 * false and the limiter counts every request exactly as before.
 */
export function testAwareLimiter(opts: Partial<Options>): TaggedLimiter {
  const mw = rateLimit({ ...opts, skip: () => isTest }) as unknown as TaggedLimiter;
  mw[RATE_LIMITED] = true;
  return mw;
}

/** Whether `fn` is a limiter this module produced. */
export function isRateLimiter(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as TaggedLimiter)[RATE_LIMITED] === true;
}
