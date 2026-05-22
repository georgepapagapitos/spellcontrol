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
 *   https://spellcontrol.app/s/<token>      — HTTPS App Link (intent filter wired but
 *                                             unverified; honored if the OS ever routes it)
 *   https://<anything>/s/<token>            — generic fallback used by tests
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
    if (host !== 'share') return null;
    // `spellcontrol://share/<token>` parses with hostname=share, pathname=/<token>.
    // `spellcontrol://share?token=<token>` parses with hostname=share, pathname=''.
    const fromPath = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean)[0];
    const fromQuery = parsed.searchParams.get('token');
    const token = fromPath || fromQuery;
    return token ? buildShareRoute(token) : null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const sIdx = segments.indexOf('s');
  if (sIdx !== -1 && segments[sIdx + 1]) {
    return buildShareRoute(segments[sIdx + 1]);
  }

  return null;
}

// URL.pathname / URLSearchParams already percent-decode the value; the
// route handler downstream re-encodes via encodeURIComponent. Splitting the
// re-encode here keeps the segment readable in tests and avoids the
// double-encoding hazard.
function buildShareRoute(rawToken: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(rawToken);
    } catch {
      return rawToken;
    }
  })();
  return `/s/${encodeURIComponent(decoded)}`;
}

/** Result of parsing an OAuth callback deep link. */
export interface OAuthCallback {
  /** Single-use handoff code to exchange for a session (success). */
  code?: string;
  /** Set instead of `code` when the OAuth flow failed or was cancelled. */
  error?: string;
}

/**
 * Parse a `spellcontrol://oauth/callback` deep link — the hop the backend's
 * Google callback uses to return into the native app. Returns the handoff
 * code, or an error marker, or `null` for any URL that isn't an OAuth
 * callback. Exported for unit testing.
 */
export function parseOAuthCallback(url: string): OAuthCallback | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'spellcontrol:') return null;
  const host = parsed.hostname || parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
  if (host !== 'oauth') return null;
  const code = parsed.searchParams.get('code');
  if (code) return { code };
  return { error: parsed.searchParams.get('error') ?? 'google' };
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
    // Lazy import: keeps the auth store (and its sync dependency graph) out of
    // this module's import side, so parseDeepLink stays cheap to unit-test.
    void import('../store/auth').then(({ useAuth }) => {
      if (oauth.code) {
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
