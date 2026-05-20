import { App, type URLOpenListenerEvent } from '@capacitor/app';
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

/**
 * Subscribe to native deep links and route them through react-router.
 *
 * Two entry points:
 *   1. **Cold start** — `App.getLaunchUrl()` returns the URL that opened
 *      the app this session, if any. We give the router a tick to mount
 *      before navigating so the route push isn't lost.
 *   2. **Warm open** — `appUrlOpen` fires whenever the OS hands a new
 *      URL to the running app (e.g. user taps a share link while the
 *      app is backgrounded). Same routing path as cold start.
 *
 * Returns a teardown function; web is a no-op.
 */
export function initDeepLinks(navigate: Navigate): () => void {
  if (!isNativePlatform()) return () => {};

  void App.getLaunchUrl()
    .then((res) => {
      if (!res?.url) return;
      const target = parseDeepLink(res.url);
      if (target) navigate(target);
    })
    .catch(() => {});

  const handlePromise = App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    const target = parseDeepLink(event.url);
    if (target) navigate(target);
  });

  return () => {
    void handlePromise.then((h) => h.remove()).catch(() => {});
  };
}
