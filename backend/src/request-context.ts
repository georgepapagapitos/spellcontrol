import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger';

/**
 * One id per request, stashed on `res.locals` and echoed as `X-Request-Id` —
 * so a user reporting a problem, or the unhandled-error handler below, has
 * something to quote. Fly sets `fly-request-id` at the edge; honoring it
 * when present means this id also matches Fly's own platform logs for the
 * same request, instead of a second, unrelated one.
 */
export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['fly-request-id'] as string | undefined) || crypto.randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/**
 * Final error handler. Logs WHAT broke and WHO hit it (request id + user),
 * not just the bare stack an alert used to carry, and returns the request
 * id in the body so a user can quote it back.
 */
export function unhandledErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (res.locals.requestId as string | undefined) ?? 'unknown';
  if ((err as NodeJS.ErrnoException & { code?: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File is too large. Maximum size is 20 MB.', requestId });
    return;
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'That request is too large.', requestId });
    return;
  }
  logger.error(
    `[server] unhandled error req=${requestId} user=${req.user?.id ?? 'anon'} ${req.method} ${req.path}`,
    err
  );
  res.status(500).json({
    error: 'Something went wrong on the server. Try again in a moment.',
    requestId,
  });
}
