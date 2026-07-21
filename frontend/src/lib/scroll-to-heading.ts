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
 * Extracted from FriendsManagement.tsx's inline `friendsTab` scroll+focus
 * effect now that a second call site (YouPage's `?section=` deep link) exists.
 */
export function scrollToHeading(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  el.tabIndex = -1;
  el.focus();
}
