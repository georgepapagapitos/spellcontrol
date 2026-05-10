import { NavLink, useLocation } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { ThemePicker } from './ThemePicker';

export function Header() {
  const cardCount = useCollectionStore((s) => s.cards.length);
  const binderCount = useCollectionStore((s) => s.binders.length);
  const deckCount = useDecksStore((s) => s.decks.length);
  const setBinderPickerOpen = useCollectionStore((s) => s.setBinderPickerOpen);
  const location = useLocation();
  // Power-user gesture: tapping the Binders tab while already on /binder
  // (and there's something to pick) opens the picker sheet. The visible
  // "Switch binder" pill in the page hero is still the primary affordance —
  // this is an additive shortcut, not the only path.
  const binderTapOpensPicker = location.pathname.startsWith('/binder') && binderCount > 0;
  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <NavLink className="site-brand" to="/collection" aria-label="MTG Binder Planner">
            <span className="site-brand-mark" aria-hidden="true">
              MBP
            </span>
            <span className="site-brand-text">MTG Binder Planner</span>
          </NavLink>
          <nav className="site-nav-links" aria-label="Primary">
            <NavLink
              to="/collection"
              className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
            >
              <span>Collection</span>
              {cardCount > 0 && (
                <span className="site-nav-count" aria-label={`${cardCount} cards`}>
                  {formatCount(cardCount)}
                </span>
              )}
            </NavLink>
            <NavLink
              to="/binder"
              className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
            >
              <span>Binders</span>
              {binderCount > 0 && (
                <span className="site-nav-count" aria-label={`${binderCount} binders`}>
                  {binderCount}
                </span>
              )}
            </NavLink>
            <NavLink
              to="/decks"
              className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
            >
              <span>Decks</span>
              {deckCount > 0 && (
                <span className="site-nav-count" aria-label={`${deckCount} decks`}>
                  {deckCount}
                </span>
              )}
            </NavLink>
          </nav>
          <nav className="site-nav">
            <ThemePicker />
          </nav>
        </div>
      </header>
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
          to="/binder"
          className={({ isActive }) =>
            isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
          }
          onClick={(e) => {
            if (binderTapOpensPicker) {
              e.preventDefault();
              setBinderPickerOpen(true);
            }
          }}
          aria-haspopup={binderTapOpensPicker ? 'dialog' : undefined}
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
        <ThemePicker variant="tab" />
      </nav>
    </>
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
  // List rows with bullet markers — reads as "your inventory of items".
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
  // 3-ring binder — tall rectangle with three rings on the spine and a
  // separator suggesting pages.
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
  // Two offset card outlines — the "stack of cards" mental model the
  // user expects, drawn in the same outline language as the others.
  return (
    <svg {...ICON_BASE}>
      <rect x="3" y="7" width="13" height="14" rx="1.8" />
      <path d="M8 4h11a2 2 0 0 1 2 2v11" />
    </svg>
  );
}

/** Compact thousands formatting so a 12,000-card collection still fits the nav. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
