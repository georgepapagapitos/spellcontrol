import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

/**
 * Mirrors Header's formatCount (intentionally copied, not imported — keeps the
 * hub shell decoupled from the header so either can change independently).
 */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

export interface HubTab {
  to: string;
  label: string;
  /** Caller derives this from the live pathname — exact vs prefix match differs
   *  per tab, so the rule stays with the hub that owns the routes. */
  active: boolean;
  /** Count chip. Omitted or 0 renders no chip. */
  count?: number;
  /** Plural noun for the count's screen-reader label, e.g. "cards" → "12 cards". */
  countNoun?: string;
}

/**
 * The in-page section nav shared by the Collection hub (Cards / Binders /
 * Lists / Combos / Sets), the Decks hub (My Decks / Discover / Saved / Cube),
 * and the social hub (Friends / Trades / Pods).
 *
 * Both hubs hand-rolled the same `<nav>` + `<Link className={active ? … : …}
 * aria-current={…}>` block, five and three times over, which meant any fix to
 * the strip had to be made twice and the `aria-current` wiring was restated at
 * every tab.
 *
 * The nav-pill look here is deliberate and guide-mandated, not drift:
 * STYLE_GUIDE § Tabs / view switchers reserves it for real route navigation and
 * names the Collection hub as the reference. A page-level "distinct views"
 * switcher is a different control — use the `underline` variant of Tabs.tsx —
 * and an exclusive-value picker is a third thing again (native radios).
 *
 * The strip is the SECOND nav tier, though, so its current tab is marked with
 * an accent underline rather than the header's cover dye — two dyed tabs
 * stacked gave a parent and its child the same weight. See the
 * `.collection-hub-tabs .site-nav-link.active` rule in `styles/responsive-nav.css`.
 */
export function HubTabsNav({ ariaLabel, tabs }: { ariaLabel: string; tabs: HubTab[] }) {
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  // Re-run on anything that moves the tabs, not just the route. The count
  // chips ("12K") arrive ASYNC — they widen the strip after first paint and
  // pushed the active tab back out of view when this only keyed on the route.
  const layoutKey = tabs.map((t) => `${t.to}:${t.active ? 1 : 0}:${t.count ?? ''}`).join('|');

  // Keep the current tab visible. The strip is a horizontal scroller
  // (`overflow-x: auto`) and nothing was scrolling it, so on a 360px phone the
  // Collection hub's own active tab could sit half-clipped past the right edge
  // — you couldn't see which section you were in.
  //
  // scrollLeft, not scrollIntoView(): the strip is `position: sticky`, and
  // scrollIntoView walks EVERY scrollable ancestor, so it would also yank
  // `.app-main` (the app's only real scroll region) on each route change.
  useEffect(() => {
    const nav = navRef.current;
    const el = activeRef.current;
    if (!nav || !el) return;
    const navBox = nav.getBoundingClientRect();
    const elBox = el.getBoundingClientRect();
    // Rect deltas rather than offsetLeft — independent of which ancestor
    // happens to be the offsetParent.
    const pad = 16;
    const pastRight = elBox.right - navBox.right;
    const pastLeft = navBox.left - elBox.left;
    if (pastRight > 0) nav.scrollLeft += pastRight + pad;
    else if (pastLeft > 0) nav.scrollLeft -= pastLeft + pad;
  }, [layoutKey]);

  return (
    <nav className="collection-hub-tabs" aria-label={ariaLabel} ref={navRef}>
      {tabs.map(({ to, label, active, count, countNoun }) => (
        <Link
          key={to}
          to={to}
          ref={active ? activeRef : undefined}
          className={active ? 'site-nav-link active' : 'site-nav-link'}
          aria-current={active ? 'page' : undefined}
        >
          <span>{label}</span>
          {count !== undefined && count > 0 && (
            <span
              className="site-nav-count"
              aria-label={countNoun ? `${count} ${countNoun}` : String(count)}
            >
              {formatCount(count)}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
