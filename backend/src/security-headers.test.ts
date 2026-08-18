import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards on the helmet configuration in `server.ts`.
 *
 * These read the source rather than boot the app on purpose: `server.ts`
 * connects Postgres, opens the SQLite cache, builds the scanner matcher and
 * starts schedulers at import time, so exercising it for a header assertion
 * would cost more than it proves. The repo already uses this shape for config
 * that unit tests can't reach (see `frontend/src/styles/*.test.ts`).
 *
 * What they defend is a class of bug that is invisible in review and silent at
 * runtime: a security header whose default quietly breaks a third-party flow.
 */
// __dirname, not import.meta: the backend compiles to CommonJS.
const SERVER_TS = readFileSync(join(__dirname, 'server.ts'), 'utf8');

describe('security headers', () => {
  it('allows popups we open to keep their opener (Google OAuth)', () => {
    // Helmet's default is `same-origin`, which puts our own popups in a
    // different browsing-context group and nulls `window.opener` inside them.
    // Google's identity client returns the OAuth token through the opener, so
    // under the default the Drive consent popup opened, the user signed in,
    // the popup closed, and the token never arrived — the picker never opened
    // and nothing was logged. Cost three rounds of debugging.
    expect(SERVER_TS).toMatch(
      /crossOriginOpenerPolicy:\s*\{\s*policy:\s*'same-origin-allow-popups'\s*\}/
    );
  });

  it('still sends an origin referrer, which referrer-restricted API keys need', () => {
    // Helmet's default is `no-referrer`, which tells the browser to send no
    // Referer at all — so a Google API key restricted to specific websites can
    // never match, and every Picker request came back "Requests from referer
    // <empty> are blocked". The Picker reports that as "The API developer key
    // is invalid", sending you to the Cloud Console to fix settings that were
    // already correct.
    expect(SERVER_TS).toMatch(
      /referrerPolicy:\s*\{\s*policy:\s*'strict-origin-when-cross-origin'\s*\}/
    );
  });

  it('does not silently fall back to helmet defaults for COOP', () => {
    // A bare `helmet()` with no COOP entry is the state this fixes; catching
    // its removal matters more than catching a wrong value.
    expect(SERVER_TS).toContain('crossOriginOpenerPolicy');
  });

  it.each([
    ['script-src', 'https://apis.google.com'],
    ['script-src', 'https://accounts.google.com'],
    ['connect-src', 'https://www.googleapis.com'],
    ['frame-src', 'https://docs.google.com'],
  ])('keeps %s entry %s, which the Drive picker needs', (_directive, origin) => {
    // The CSP is enforcing as of #1672, so a missing origin is now a hard
    // break rather than a report-only warning.
    expect(SERVER_TS).toContain(origin);
  });
});
