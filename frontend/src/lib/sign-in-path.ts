import { useLocation } from 'react-router-dom';

/**
 * Where a guest gate sends someone to sign in.
 *
 * Every "Sign in" door on a gated surface (Friends, Trades, Pods, Online play,
 * a deck's share dialog, the header) carries the page it was tapped from as
 * `returnTo`, so a finished sign-in lands the person back on that page rather
 * than on the default post-auth landing. Before this, tapping Sign in on
 * Friends, creating an account, and being dropped on Home — with Friends only
 * reachable again through Home's quick actions on a phone — was the first
 * dead end a new player hit. AuthPage's `safeReturnTo` still validates the
 * value on the way back (same-origin relative path only).
 *
 * `/` and the auth pages themselves carry no `returnTo` — AuthPage's default
 * landing already covers them, and `/auth?returnTo=/auth` would be a loop.
 */
export function signInPath(returnTo: string): string {
  if (!returnTo || returnTo === '/' || returnTo.startsWith('/auth')) return '/auth';
  return `/auth?returnTo=${encodeURIComponent(returnTo)}`;
}

/** `signInPath` for the current route (pathname + search). */
export function useSignInPath(): string {
  const { pathname, search } = useLocation();
  return signInPath(`${pathname}${search}`);
}
