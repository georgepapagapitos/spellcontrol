import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { isNativePlatform } from './platform';

type Navigate = (path: string) => void;

/**
 * Map an inbound deep-link URL to an in-app route, or `null` if it's
 * something we don't recognize (in which case the caller leaves the
 * current view alone — the URL probably came from a stale link or a
 * future scheme the build doesn't know about yet).
 *
 * Supported shapes:
 *
 *   spellcontrol://share/<token>            — primary custom scheme
 *   spellcontrol://share?token=<token>      — query-string variant, for hand-built links
 *   spellcontrol://profile/<username>       — same custom-scheme pattern for public profiles
 *   spellcontrol://deck/<slug>               — same custom-scheme pattern for public decks
 *   https://spellcontrol.app/s/<token>      — HTTPS App Link (intent filter wired but
 *                                             unverified; honored if the OS ever routes it)
 *   https://<anything>/s/<token>            — generic fallback used by tests
 *   https://<anything>/u/<username>         — public profile landing (w1-public-routes-linkability)
 *   https://<anything>/d/<slug>             — public deck landing (w1-public-routes-linkability)
 *
 * Exported for unit testing — the listener wiring below stays untested
 * because it's a thin shim over the plugin.
 */
export function parseDeepLink(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol === 'spellcontrol:') {
    const host = parsed.hostname || parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
    // `spellcontrol://share/<token>` parses with hostname=share, pathname=/<token>.
    // `spellcontrol://share?token=<token>` parses with hostname=share, pathname=''.
    const fromPath = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean)[0];
    const fromQuery = parsed.searchParams.get('token');
    const token = fromPath || fromQuery;
    if (!token) return null;
    if (host === 'share') return buildShareRoute(token);
    if (host === 'profile') return buildProfileRoute(token);
    if (host === 'deck') return buildDeckRoute(token);
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const sIdx = segments.indexOf('s');
  if (sIdx !== -1 && segments[sIdx + 1]) {
    return buildShareRoute(segments[sIdx + 1]);
  }
  const uIdx = segments.indexOf('u');
  if (uIdx !== -1 && segments[uIdx + 1]) {
    return buildProfileRoute(segments[uIdx + 1]);
  }
  const dIdx = segments.indexOf('d');
  if (dIdx !== -1 && segments[dIdx + 1]) {
    return buildDeckRoute(segments[dIdx + 1]);
  }

  return null;
}

// URL.pathname / URLSearchParams already percent-decode the value; the
// route handler downstream re-encodes via encodeURIComponent. Splitting the
// re-encode here keeps the segment readable in tests and avoids the
// double-encoding hazard.
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function buildShareRoute(rawToken: string): string {
  return `/s/${encodeURIComponent(decodeSegment(rawToken))}`;
}

function buildProfileRoute(rawUsername: string): string {
  return `/u/${encodeURIComponent(decodeSegment(rawUsername))}`;
}

function buildDeckRoute(rawSlug: string): string {
  return `/d/${encodeURIComponent(decodeSegment(rawSlug))}`;
}

/** Result of parsing an OAuth callback deep link. */
export interface OAuthCallback {
  /** Returning user: single-use handoff code to exchange for a session. */
  code?: string;
  /** First-time user: signup token to carry to the choose-username screen. */
  signup?: string;
  /** Suggested username that accompanies a `signup` token. */
  suggested?: string;
  /** Link-mode success: the value names which provider got linked ('google'). */
  linked?: string;
  /** Link-mode failure marker (e.g. 'already_linked', 'has_google'). */
  linkError?: string;
  /** Set when sign-in itself failed or was cancelled. */
  error?: string;
}

/**
 * Parse an OAuth callback deep link — the hop the backend's Google callback
 * uses to return into the native app. Only the Android App Link form is
 * accepted (`https://spellcontrol.com/oauth/callback?...`), verified via
 * `/.well-known/assetlinks.json`.
 *
 * Returns the handoff code (returning user), a signup token (first-time
 * user), a link-mode marker, an error marker, or `null` for any URL that
 * isn't an OAuth callback. Exported for unit testing.
 */
export function parseOAuthCallback(url: string): OAuthCallback | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isOAuthCallbackUrl(parsed)) return null;
  const code = parsed.searchParams.get('code');
  if (code) return { code };
  const signup = parsed.searchParams.get('signup');
  if (signup) return { signup, suggested: parsed.searchParams.get('suggested') ?? undefined };
  const linked = parsed.searchParams.get('linked');
  if (linked) return { linked };
  const linkError = parsed.searchParams.get('linkError');
  if (linkError) return { linkError };
  return { error: parsed.searchParams.get('error') ?? 'google' };
}

function isOAuthCallbackUrl(parsed: URL): boolean {
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'spellcontrol.com') return false;
  // Trailing-slash tolerant; rejects sibling paths like /oauth/callbacks.
  const path = parsed.pathname.replace(/\/+$/, '');
  return path === '/oauth/callback';
}

/**
 * Dispatch one inbound deep-link URL. OAuth callbacks finish the Google
 * sign-in (and close the system browser); everything else routes through
 * react-router as a share link.
 */
function handleDeepLink(url: string, navigate: Navigate): void {
  const oauth = parseOAuthCallback(url);
  if (oauth) {
    // The flow is done — dismiss the system browser tab regardless of outcome.
    void Browser.close().catch(() => {});
    if (oauth.signup) {
      // First-time user — carry the signup token to the choose-username screen.
      const params = new URLSearchParams({ token: oauth.signup });
      if (oauth.suggested) params.set('suggested', oauth.suggested);
      navigate(`/auth/choose-username#${params.toString()}`);
      return;
    }
    if (oauth.linked || oauth.linkError) {
      // Settings-side link/unlink finished — surface the result there. Settings
      // reads the query params on mount, toasts, and clears them.
      const params = new URLSearchParams();
      if (oauth.linked) params.set('linked', oauth.linked);
      if (oauth.linkError) params.set('linkError', oauth.linkError);
      navigate(`/settings?${params.toString()}`);
      return;
    }
    // Lazy import: keeps the auth store (and its sync dependency graph) out of
    // this module's import side, so parseDeepLink stays cheap to unit-test.
    void import('../store/auth').then(({ useAuth }) => {
      if (oauth.code) {
        // A second delivery of the same callback (Android occasionally fires
        // appUrlOpen twice; the user can also tap the fallback page's "Open
        // SpellControl" button after the first delivery already signed them
        // in) would re-POST a handoff code that the backend has already
        // consumed. Short-circuit on an already-authed session so the replay
        // is a no-op instead of a logout.
        if (useAuth.getState().status === 'authed') {
          navigate('/');
          return;
        }
        void useAuth.getState().completeGoogleOAuth(oauth.code);
      } else {
        useAuth.setState({ error: 'Google sign-in was cancelled. Please try again.' });
      }
    });
    return;
  }
  const target = parseDeepLink(url);
  if (target) navigate(target);
}

/**
 * Subscribe to native deep links.
 *
 * Two entry points:
 *   1. **Cold start** — `App.getLaunchUrl()` returns the URL that opened
 *      the app this session, if any. We give the router a tick to mount
 *      before navigating so the route push isn't lost.
 *   2. **Warm open** — `appUrlOpen` fires whenever the OS hands a new
 *      URL to the running app (a share link, or the OAuth callback
 *      returning from the system browser). Same handling as cold start.
 *
 * Returns a teardown function; web is a no-op.
 */
export function initDeepLinks(navigate: Navigate): () => void {
  if (!isNativePlatform()) return () => {};

  void App.getLaunchUrl()
    .then((res) => {
      if (res?.url) handleDeepLink(res.url, navigate);
    })
    .catch(() => {});

  const handlePromise = App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    handleDeepLink(event.url, navigate);
  });

  return () => {
    void handlePromise.then((h) => h.remove()).catch(() => {});
  };
}
