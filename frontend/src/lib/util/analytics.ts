import { apiUrl } from '@/lib/api/api-base';

/**
 * First-party, cookieless beacon (see backend/src/routes/events.ts).
 *
 * Four shapes ride one endpoint, and every one sends only an event name, a
 * normalized path, and low-cardinality strings — no ids, no user data — so an
 * aggregate counter is all the server can ever hold:
 *
 *  - usage events (`track`): a name and a path.
 *  - client errors (`reportError`): the exception's message and the script
 *    frame it came from, for uncaught errors, unhandled rejections, and
 *    render crashes the ErrorBoundary catches. Deduped per page load and
 *    capped, so a looping error is one beacon, not a flood.
 *  - web vitals (`startVitals`): LCP, CLS and INP for the page load, sent
 *    once when the page is hidden. The server keeps the band, not the value.
 *
 *  - suggestion labels (lib/util/suggestion-labels.ts): what a player did with
 *    a suggestion, for a commander. Off when the player turns it off in Settings.
 *
 * Fire-and-forget: a failed beacon is silently dropped.
 */
export type EventName =
  | 'pageview'
  | 'import_started'
  | 'sample_loaded'
  | 'browse_decks'
  | 'sign_in'
  | 'guide_cta'
  // Everything above fires on the landing page. These four are the first
  // events past it, so a traffic spike reads as a funnel instead of a cliff:
  // a local game needs no account and otherwise writes nothing server-side,
  // which made anonymous play unmeasurable by construction.
  | 'play_started'
  | 'register_completed'
  | 'deck_created'
  | 'binder_created'
  // The landing's own escape hatch. Counted like any other door, because
  // "how many people wanted past the storefront without taking any of it"
  // is the question that justifies the door existing.
  | 'skipped_welcome';

const ID_ROUTES =
  /^\/(s|d|u|gn|pods|friends|decks\/cube|decks|collection\/(?:binders|lists|sets))\/([^/]+)(\/.*)?$/;
const STATIC_SECOND = new Set(['new', 'discover', 'saved', 'compare', 'cube', 'combos']);

/** Collapse per-entity segments so counters stay low-cardinality and free of tokens/slugs. */
export function normalizePath(pathname: string): string {
  const m = ID_ROUTES.exec(pathname);
  if (!m) return pathname;
  const [, prefix, seg, rest] = m;
  if (prefix === 'decks' && STATIC_SECOND.has(seg)) return pathname;
  return `/${prefix}/:id${rest ? '/*' : ''}`;
}

/** Fire-and-forget POST of one beacon body; the callers above and suggestion-labels.ts build it. */
export function sendBeaconPayload(payload: Record<string, unknown>): void {
  send(payload);
}

function send(payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  try {
    if (
      navigator.sendBeacon?.(apiUrl('/api/events'), new Blob([body], { type: 'application/json' }))
    ) {
      return;
    }
    void fetch(apiUrl('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Beacons are best-effort by definition.
  }
}

/**
 * Usage counters are suppressed for the app's own admin. With a handful of
 * accounts in production the owner's own browsing was indistinguishable from
 * a visitor's, which made every count an upper bound and the totals
 * uninterpretable. Errors and vitals are deliberately NOT suppressed — the
 * owner's crashes and slow pages are the signal we least want to lose.
 */
let usageSuppressed = false;

export function setUsageSuppressed(suppressed: boolean): void {
  usageSuppressed = suppressed;
}

export function track(name: EventName, path?: string): void {
  // Guarded here rather than at each call site: the store actions that fire
  // these events also run under the node-environment tests, where there is
  // no `window` to read a path from.
  if (usageSuppressed || typeof window === 'undefined') return;
  send({ name, path: normalizePath(path ?? window.location.pathname) });
}

// ---------------------------------------------------------------------------
// Client errors

export type ErrorKind = 'error' | 'rejection' | 'render';

/** Browser noise that is not a defect: benign observer warnings, aborted navigations. */
const IGNORED = /ResizeObserver loop|AbortError|The operation was aborted/;
const MAX_ERRORS_PER_LOAD = 10;
const seen = new Set<string>();

/**
 * Message + top stack frame for an unknown thrown value. The frame is the
 * first stack line that names a script, trimmed to `<file>:<line>:<col>` so
 * the server can key on it; origin and query are dropped so the row never
 * carries a token that happened to be in a URL.
 */
export function describeError(value: unknown): { message: string; frame: string } {
  const err = value as { message?: unknown; stack?: unknown } | null;
  const message =
    typeof err?.message === 'string' && err.message
      ? err.message
      : typeof value === 'string'
        ? value
        : String(value ?? 'Unknown error');
  const stack = typeof err?.stack === 'string' ? err.stack : '';
  const line = stack.split('\n').find((l) => /\.[cm]?js(\?[^:]*)?:\d+/.test(l)) ?? '';
  const m = /([^\s/()]+\.[cm]?js)(?:\?[^:]*)?:(\d+):(\d+)/.exec(line);
  const frame = m ? `${m[1]}:${m[2]}:${m[3]}` : '';
  return { message: message.slice(0, 500), frame };
}

export function reportError(kind: ErrorKind, value: unknown): void {
  const { message, frame } = describeError(value);
  if (IGNORED.test(message)) return;
  const key = `${kind}|${message}|${frame}`;
  if (seen.has(key) || seen.size >= MAX_ERRORS_PER_LOAD) return;
  seen.add(key);
  send({ name: 'error', path: normalizePath(window.location.pathname), kind, message, frame });
}

/** Window-level listeners; the ErrorBoundary covers render crashes itself. */
export function installErrorReporting(): void {
  window.addEventListener('error', (e) => reportError('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('rejection', e.reason));
}

// ---------------------------------------------------------------------------
// Web vitals

export type VitalMetric = 'LCP' | 'CLS' | 'INP';

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

/**
 * Largest CLS session window: shifts less than 1s apart and inside a 5s
 * window group into one session; the page's CLS is its largest session.
 * Mirrors the web-vitals library's definition.
 */
export function clsSessionMax(shifts: { startTime: number; value: number }[]): number {
  let max = 0;
  let session = 0;
  let first = 0;
  let prev = 0;
  for (const s of shifts) {
    if (session && s.startTime - prev < 1000 && s.startTime - first < 5000) session += s.value;
    else {
      session = s.value;
      first = s.startTime;
    }
    prev = s.startTime;
    if (session > max) max = session;
  }
  return max;
}

/** Set by startVitals(); App.tsx calls noteVitalsRoute on every SPA navigation. */
let routeChanged: ((pathname: string) => void) | null = null;

/** Tell the vitals observer the SPA moved to another route (flushes the one it leaves). */
export function noteVitalsRoute(pathname: string): void {
  routeChanged?.(pathname);
}

// A rapid navigator must not trip the endpoint's 60/min limiter with vitals alone.
const MAX_VITAL_FLUSHES = 30;

/**
 * Observe vitals and beacon them per route. LCP is a load metric, so it is
 * credited to the landing route once. CLS (largest session window) and INP
 * (slowest interaction) are flushed for the route they happened on when the
 * SPA navigates (noteVitalsRoute) and when the page is hidden, then reset for
 * the next route. A later route with no shifts or interactions sends nothing;
 * the landing route still sends CLS 0, as before. INP is the slowest
 * interaction seen, which is the web-vitals value for routes with fewer than
 * fifty interactions and slightly pessimistic beyond that.
 */
export function startVitals(): void {
  if (typeof PerformanceObserver === 'undefined' || document.visibilityState === 'hidden') return;
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  let path = normalizePath(window.location.pathname);
  let landing = true;
  let flushes = 0;
  let shifts: { startTime: number; value: number }[] = [];
  let lcp = -1;
  let inp = -1;
  const observers: { po: PerformanceObserver; cb: (entries: PerformanceEntry[]) => void }[] = [];
  const observe = (type: string, cb: (entries: PerformanceEntry[]) => void, opts = {}) => {
    if (!supported.includes(type)) return;
    try {
      const po = new PerformanceObserver((list) => cb(list.getEntries()));
      po.observe({ type, buffered: true, ...opts });
      observers.push({ po, cb });
    } catch {
      // An observer type the browser lists but refuses is a skipped metric.
    }
  };
  observe('largest-contentful-paint', (entries) => {
    if (landing) lcp = entries[entries.length - 1]?.startTime ?? lcp;
  });
  observe('layout-shift', (entries) => {
    for (const e of entries as LayoutShiftEntry[]) {
      if (!e.hadRecentInput) shifts.push({ startTime: e.startTime, value: e.value });
    }
  });
  observe(
    'event',
    (entries) => {
      for (const e of entries) if (e.duration > inp) inp = e.duration;
    },
    { durationThreshold: 40 }
  );
  const flush = () => {
    if (flushes >= MAX_VITAL_FLUSHES) return;
    // Entries are delivered asynchronously; drain what the observers still hold
    // so a late shift lands on the route it happened on, not the next one.
    for (const { po, cb } of observers) {
      const pending = po.takeRecords?.() ?? [];
      if (pending.length) cb(pending);
    }
    flushes += 1;
    if (landing && lcp >= 0) send({ name: 'vital', path, metric: 'LCP', value: Math.round(lcp) });
    if (shifts.length) send({ name: 'vital', path, metric: 'CLS', value: clsSessionMax(shifts) });
    else if (landing && supported.includes('layout-shift'))
      send({ name: 'vital', path, metric: 'CLS', value: 0 });
    if (inp >= 0) send({ name: 'vital', path, metric: 'INP', value: Math.round(inp) });
    landing = false;
    lcp = -1;
    shifts = [];
    inp = -1;
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  routeChanged = (pathname) => {
    const next = normalizePath(pathname);
    if (next === path) return;
    flush();
    path = next;
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onHidden);
}
