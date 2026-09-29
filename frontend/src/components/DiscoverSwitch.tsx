import './DiscoverSwitch.css';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs } from './Tabs';

export type DiscoverSection = 'decks' | 'brewers';

const PANEL_ID = 'discover-panel';

const SECTIONS = [
  { id: 'decks' as const, label: 'Decks', controls: PANEL_ID },
  { id: 'brewers' as const, label: 'Brewers', controls: PANEL_ID },
];

const ROUTES: Record<DiscoverSection, string> = {
  decks: '/decks/discover',
  brewers: '/decks/discover/brewers',
};

/**
 * Decks | Brewers, the second view switch inside Discover. Two routes, one
 * underline strip (STYLE_GUIDE § Tabs: a page-level "distinct views"
 * switcher), rendered by both pages so it never moves when you change view.
 * It sits under the hub strip rather than becoming a hub tab: Brewers is a
 * way of browsing Discover, not a fifth place in the Decks hub.
 */
export function DiscoverSwitch({ value }: { value: DiscoverSection }) {
  const navigate = useNavigate();
  return (
    <Tabs<DiscoverSection>
      variant="underline"
      ariaLabel="Discover"
      tabs={SECTIONS}
      value={value}
      onChange={(next) => {
        if (next !== value) navigate(ROUTES[next]);
      }}
    />
  );
}

/** The tabpanel the switch controls: wrap everything below the switch. */
export function DiscoverPanel({
  section,
  children,
}: {
  section: DiscoverSection;
  children: ReactNode;
}) {
  return (
    <div
      className="discover-panel"
      role="tabpanel"
      id={PANEL_ID}
      aria-labelledby={`sc-tab-${section}`}
    >
      {children}
    </div>
  );
}
