import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasEverVisited } from './first-run';
import type { AuthStatus } from '../store/auth';

/**
 * Paths reachable without first satisfying the first-run gate: the root
 * landing page itself (and its /welcome alias), the auth flow, OAuth landing
 * pages, and every public share-link surface a stranger's first-ever visit
 * can land on directly (STYLE_GUIDE "Public shared views": these are "often
 * a non-user's first contact" and must stay reachable, not bounce to the
 * marketing page). `/s/:token` was the only one exempted — `/u/:username`
 * (public profile), `/d/:slug` (public deck), and `/gn/:token` + `/gn/s/:token`
 * (a game-night invite + its stable weekly link) are the same kind of link
 * and were missing, so a first-time guest tapping any of them landed on `/`
 * instead of the content they were sent, silently breaking "anyone with the
 * link can RSVP/view, no account needed" on every one of those surfaces.
 * Exported for unit tests; the hook below uses it internally.
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
    pathname.startsWith('/gn/')
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
