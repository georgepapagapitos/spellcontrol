import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { hasEverVisited, markEverVisited } from './first-run';
import type { AuthStatus } from '../store/auth';

/**
 * Paths that don't count as entering the app, so arriving on one leaves a
 * first-time guest's landing intact: the root landing page itself (and its
 * /welcome alias), the auth flow, account
 * recovery (/forgot-password, /reset-password, /verify-email — reached from
 * an emailed link, which can land before any first-run choice was ever
 * made), OAuth landing pages, and every public/share route App.tsx renders
 * outside the auth gate
 * (unauthed-reachable, no <Layout> chrome) — `/s/:token`, `/u/:username`,
 * `/d/:slug`, `/gn/:token`, `/gn/s/:token` — plus `/decks/discover` and its
 * `/brewers` view, the always-reachable public routes that DOES live inside <Layout>. Mirror
 * App.tsx's own route table when either list changes: this used to list only
 * `/s/`, so a first-time guest following a `/u/`, `/d/`, or `/gn/` link (or
 * the welcome hero's own "Browse public decks" CTA, which deliberately marks
 * no visited flag) got bounced straight back to `/` before the page they
 * clicked through to ever painted. Exported for unit tests; the hook below
 * uses it internally.
 */
export function isFirstRunExempt(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/welcome' ||
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/verify-email' ||
    pathname.startsWith('/s/') ||
    pathname.startsWith('/u/') ||
    pathname.startsWith('/d/') ||
    pathname.startsWith('/gn/') ||
    pathname === '/decks/discover' ||
    pathname === '/decks/discover/brewers'
  );
}

/**
 * First-run arrival: the root landing (`/`) greets a never-visited guest with
 * its doors (import, try samples, sign in), but a guest who arrives anywhere
 * else in the app lands where the link pointed, and that arrival counts as
 * their first visit, so `/` takes them into the app from then on.
 *
 * This used to redirect a never-visited guest from any in-app path to `/`, so
 * someone following a search result or a friend's link to /rules or
 * /search?q= landed on the storefront with the destination lost (E344). A
 * crawler got the same bounce. The public/share routes above stay exempt: a
 * stranger opening a shared deck hasn't entered the app, so `/` still shows
 * them the landing afterwards.
 *
 * markEverVisited() from `./first-run` is also called when the user picks a
 * landing door or completes any auth choice.
 *
 * Only acts once auth status has resolved to 'guest'; bootstrap's 'loading' /
 * 'unknown' phase is ignored so a user about to come back authed isn't marked.
 */
export function useFirstRunGate(status: AuthStatus): void {
  const location = useLocation();
  useEffect(() => {
    if (status !== 'guest') return;
    if (hasEverVisited()) return;
    if (isFirstRunExempt(location.pathname)) return;
    markEverVisited();
  }, [status, location.pathname]);
}
