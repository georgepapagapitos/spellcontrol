import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasEverVisited } from './first-run';
import type { AuthStatus } from '../store/auth';

/**
 * Paths reachable without first satisfying the first-run gate: the root
 * landing page itself (and its /welcome alias), the auth flow, OAuth landing
 * pages, and every public/share route App.tsx renders outside the auth gate
 * (unauthed-reachable, no <Layout> chrome) — `/s/:token`, `/u/:username`,
 * `/d/:slug`, `/gn/:token`, `/gn/s/:token` — plus `/decks/discover`, the one
 * always-reachable public route that DOES live inside <Layout>. Mirror
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
    pathname === '/oauth/callback' ||
    pathname.startsWith('/s/') ||
    pathname.startsWith('/u/') ||
    pathname.startsWith('/d/') ||
    pathname.startsWith('/gn/') ||
    pathname === '/decks/discover'
  );
}

/**
 * First-run gate: on a brand-new install, route the user to the root landing
 * page before dropping them into the app. The landing offers three doors:
 * import, try samples, or sign in. The gate is one-shot — markEverVisited() from
 * `./first-run` is called when the user chooses a door (import/samples) or
 * when any auth choice completes (login, register, Google, "Continue without
 * an account"), after which this hook no-ops forever.
 *
 * Only fires once auth status has resolved to 'guest'; bootstrap's
 * 'loading' / 'unknown' phase is intentionally ignored so we don't
 * flash-redirect a user who's about to come back authed.
 */
export function useFirstRunGate(status: AuthStatus): void {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (status !== 'guest') return;
    if (hasEverVisited()) return;
    if (isFirstRunExempt(location.pathname)) return;
    navigate('/', { replace: true });
  }, [status, location.pathname, navigate]);
}
