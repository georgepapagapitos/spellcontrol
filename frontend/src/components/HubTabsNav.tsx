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
 * Lists / Sets / Cube) and the Decks hub (My Decks / Discover / Saved).
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
 */
export function HubTabsNav({ ariaLabel, tabs }: { ariaLabel: string; tabs: HubTab[] }) {
  return (
    <nav className="collection-hub-tabs" aria-label={ariaLabel}>
      {tabs.map(({ to, label, active, count, countNoun }) => (
        <Link
          key={to}
          to={to}
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
