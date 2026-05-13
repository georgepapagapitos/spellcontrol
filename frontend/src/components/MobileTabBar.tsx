import { NavLink } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';

export function MobileTabBar() {
  const cardCount = useCollectionStore((s) => s.cards.length);
  const binderCount = useCollectionStore((s) => s.binders.length);
  const deckCount = useDecksStore((s) => s.decks.length);
  return (
    <nav className="mobile-tab-bar" aria-label="Primary mobile">
      <NavLink
        to="/collection"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
      >
        <span className="mobile-tab-bar-glyph">
          <CollectionIcon />
          {cardCount > 0 && (
            <span className="mobile-tab-bar-count" aria-label={`${cardCount} cards`}>
              {formatCount(cardCount)}
            </span>
          )}
        </span>
        <span className="mobile-tab-bar-label">Collection</span>
      </NavLink>
      <NavLink
        to="/binders"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
      >
        <span className="mobile-tab-bar-glyph">
          <BinderIcon />
          {binderCount > 0 && (
            <span className="mobile-tab-bar-count" aria-label={`${binderCount} binders`}>
              {binderCount}
            </span>
          )}
        </span>
        <span className="mobile-tab-bar-label">Binders</span>
      </NavLink>
      <NavLink
        to="/decks"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
      >
        <span className="mobile-tab-bar-glyph">
          <DeckIcon />
          {deckCount > 0 && (
            <span className="mobile-tab-bar-count" aria-label={`${deckCount} decks`}>
              {deckCount}
            </span>
          )}
        </span>
        <span className="mobile-tab-bar-label">Decks</span>
      </NavLink>
      <NavLink
        to="/settings"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
      >
        <span className="mobile-tab-bar-glyph">
          <GearIcon />
        </span>
        <span className="mobile-tab-bar-label">Settings</span>
      </NavLink>
    </nav>
  );
}

// All three bottom-nav icons share an outline-only stroke style for
// visual consistency. Semantics: list rows (collection), 3-ring binder
// (binders), offset cards (decks).
const ICON_BASE = {
  className: 'mobile-tab-bar-icon',
  viewBox: '0 0 24 24',
  width: 22,
  height: 22,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function CollectionIcon() {
  return (
    <svg {...ICON_BASE}>
      <circle cx="5" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="18" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9 6h12M9 12h12M9 18h9" />
    </svg>
  );
}

function BinderIcon() {
  return (
    <svg {...ICON_BASE}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M5 7h14M5 17h14" />
      <circle cx="9" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function DeckIcon() {
  return (
    <svg {...ICON_BASE}>
      <rect x="3" y="7" width="13" height="14" rx="1.8" />
      <path d="M8 4h11a2 2 0 0 1 2 2v11" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...ICON_BASE}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

/** Compact thousands formatting so a 12,000-card collection still fits the nav. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
