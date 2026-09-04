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
  // preventScroll: the scroll is scrollIntoView's job. A bare focus() runs
  // its own scroll-if-needed, and in Chromium that cancels the smooth scroll
  // just started whenever the heading is already inside the viewport — the
  // heading got focus but stayed mid-screen instead of landing at the top.
  el.focus({ preventScroll: true });
  return true;
}
