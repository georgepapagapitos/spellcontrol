import type { NextFunction, Request, Response } from 'express';

/**
 * Hostnames that once served the Android app's API and now only exist so old
 * clients keep working. One Fly app answers both these and the apex, so
 * without this check the whole SPA is reachable on a second origin (separate
 * IndexedDB and sync state, signed out, a duplicate-content crawl target).
 * Local and test hosts are not in the list, so they are unaffected.
 */
export const LEGACY_API_HOSTS: ReadonlySet<string> = new Set(['api.spellcontrol.com']);
export const CANONICAL_ORIGIN = 'https://spellcontrol.com';

/** Paths that stay served on a legacy host: the API itself, ACME/well-known, health. */
function isApiSurface(p: string): boolean {
  return p === '/health' || p.startsWith('/api/') || p.startsWith('/.well-known/');
}

/**
 * Mount after every /api route and before the SPA static block. GET/HEAD page
 * requests on a legacy host 301 to the apex; everything else falls through.
 */
export function redirectLegacyApiHost(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!LEGACY_API_HOSTS.has(req.hostname.toLowerCase())) return next();
  if (isApiSurface(req.path)) return next();
  res.redirect(301, CANONICAL_ORIGIN + req.originalUrl);
}
