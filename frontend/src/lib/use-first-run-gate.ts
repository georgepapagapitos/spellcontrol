import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasEverVisited } from './first-run';
import type { AuthStatus } from '../store/auth';

/**
 * Paths reachable without first satisfying the first-run gate: the auth
 * flow itself, the OAuth landing pages, and public share links. Exported
 * for unit tests; the hook below uses it internally.
 */
export function isFirstRunExempt(pathname: string): boolean {
  return (
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname === '/oauth/callback' ||
    pathname.startsWith('/s/')
  );
}

/**
 * First-run gate: on a brand-new install, route the user to /auth before
 * dropping them into the app. The gate is one-shot — markEverVisited()
 * from `./first-run` is set on any intentional first auth choice (login,
 * register, Google sign-in, or "Continue without an account"), after which
 * this hook no-ops forever.
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
    navigate('/auth', { replace: true });
  }, [status, location.pathname, navigate]);
}
