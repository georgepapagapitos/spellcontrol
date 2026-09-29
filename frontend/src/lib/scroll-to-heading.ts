import { prefersReducedMotion } from './use-list-flip';

/**
 * Scrolls the element with `id` into view and focuses it, so a query-param
 * deep link (e.g. `/you?section=appearance`, `/you?friendsTab=inbox`) lands
 * the user — or a screen reader — announced at the right heading instead of
 * silently at the top of the page. Headings aren't natively focusable, so
 * `tabIndex` is forced to -1 first. No-ops silently when the id doesn't exist
 * (a stale/unknown param, or a heading that hasn't rendered yet) — never
 * throws.
 *
 * Returns whether the heading existed, so a caller that retries while late
 * content is still rendering can tell a miss from a landing.
 *
 * Extracted from FriendsManagement.tsx's inline `friendsTab` scroll+focus
 * effect now that a second call site (YouPage's `?section=` deep link) exists.
 */
export function scrollToHeading(id: string, opts: { focus?: boolean } = {}): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  // `focus: false` is for re-pinning an already-announced heading after the
  // layout above it changed — scroll again, but never steal focus a second
  // time from wherever the user has since put it.
  if (opts.focus === false) return true;
  el.tabIndex = -1;
  // `scroll-heading-target` (base-layout.css) suppresses the browser's raw
  // default focus ring here: this is a programmatic scroll-anchor, not a
  // control the user tabbed to, and the scroll motion is the sighted-user
  // cue (a screen reader still gets the announcement either way) — see
  // base-layout.css for the recognized-exception rationale (B8-01).
  el.classList.add('scroll-heading-target');
  // preventScroll: the scroll is scrollIntoView's job. A bare focus() runs
  // its own scroll-if-needed, and in Chromium that cancels the smooth scroll
  // just started whenever the heading is already inside the viewport — the
  // heading got focus but stayed mid-screen instead of landing at the top.
  el.focus({ preventScroll: true });
  return true;
}

/**
 * Route-arrival focus for the app shell: moves focus to the new page's `<h1>`
 * inside `container` so a screen-reader user isn't left wherever focus last
 * was. A page that already put the caret in one of its own fields (Card
 * search's autofocused box) keeps it: the field was the page's deliberate
 * arrival target, and taking it back to the heading made that autofocus a
 * no-op on every in-app navigation.
 *
 * Returns whether arrival is settled (heading focused, or the page holds
 * focus), so a caller waiting on a lazy route can stop watching.
 */
export function focusArrivalHeading(container: HTMLElement): boolean {
  const active = document.activeElement;
  if (
    active &&
    container.contains(active) &&
    active.matches('input, textarea, select, [contenteditable="true"]')
  ) {
    return true;
  }
  const heading = container.querySelector<HTMLElement>('h1');
  if (!heading) return false;
  heading.tabIndex = -1;
  // Same recognized exception as scrollToHeading (base-layout.css): this is a
  // programmatic arrival focus, not a tabbed-to control, so the browser's raw
  // default ring is suppressed rather than reading as a rendering glitch on
  // every route change.
  heading.classList.add('scroll-heading-target');
  heading.focus({ preventScroll: true });
  return true;
}
