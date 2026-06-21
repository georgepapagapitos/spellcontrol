import { rateLimit, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';

const isTest = process.env.NODE_ENV === 'test' || !!process.env.TEST_DATABASE_URL;

/**
 * Returns a passthrough middleware in test environments and a real
 * express-rate-limit middleware in production. Avoids rate-limit state
 * leaking between test cases while keeping the production path identical.
 */
export function testAwareLimiter(
  opts: Partial<Options>
): (req: Request, res: Response, next: () => void) => void {
  return isTest ? (_req: Request, _res: Response, next: () => void) => next() : rateLimit(opts);
}
