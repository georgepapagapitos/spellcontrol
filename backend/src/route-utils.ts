import { rateLimit, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';

export const isTest = process.env.NODE_ENV === 'test' || !!process.env.TEST_DATABASE_URL;

/** Middleware this module produced, tagged so a guard can recognize it. */
export type TaggedLimiter = ((req: Request, res: Response, next: () => void) => void) & {
  [RATE_LIMITED]?: true;
};

/**
 * Marks a middleware as "this is the rate limiter".
 *
 * Needed because the middleware has two shapes: a real express-rate-limit
 * instance in production and a passthrough under test. Nothing about the
 * passthrough says "limiter", so `rate-limit-coverage.test.ts` — which runs in
 * the test env, where the passthrough is what it sees — could not otherwise
 * tell a limited route from an unlimited one.
 */
export const RATE_LIMITED = Symbol.for('spellcontrol.rateLimited');

/**
 * Returns a passthrough middleware in test environments and a real
 * express-rate-limit middleware in production. Avoids rate-limit state
 * leaking between test cases while keeping the production path identical.
 *
 * Both shapes carry `RATE_LIMITED`. CodeQL's `js/missing-rate-limiting` cannot
 * see through this branch and flags every route on every router that uses it
 * (~99 dismissed instances and counting), so the repo's real check that no
 * route ships unlimited is `rate-limit-coverage.test.ts`, not CodeQL.
 */
export function testAwareLimiter(opts: Partial<Options>): TaggedLimiter {
  const mw: TaggedLimiter = isTest
    ? (_req: Request, _res: Response, next: () => void) => next()
    : (rateLimit(opts) as unknown as TaggedLimiter);
  mw[RATE_LIMITED] = true;
  return mw;
}

/** Whether `fn` is a limiter this module produced. */
export function isRateLimiter(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as TaggedLimiter)[RATE_LIMITED] === true;
}
