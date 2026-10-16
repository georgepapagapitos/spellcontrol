import './DeckLibrary.css';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import {
  bracketBadge,
  bracketAriaWithEstimate,
  formatBracketLabel,
} from '@/lib/deck-analysis/format-bracket-label';
import type { DeckFormat } from '@/deck-builder/types';
import { NO_DISCOVER_FILTERS, type DiscoverFilters } from '@/lib/discover/discover-filters';
import { colorSelectionMatches } from '@spellcontrol/binder-routing';
import { DiscoverFiltersPopover } from './DiscoverFiltersPopover';
import { resultCountLabel } from '@/lib/search/result-count-label';
import { SearchPill } from '@/components/search/SearchPill';
import { SortMenu, type SortMenuOption } from '@/components/search/SortMenu';
import { SharedEmptyState } from '../share/SharedEmptyState';
import { ColorIdentityBar } from '../shared/ColorIdentityBar';
import { ColorPip } from '../shared/ManaSymbol';
import { Chip } from '../shared/Chip';
import { Surface } from '../shared/Surface';
import { ArtBadge } from '@/components/shared/ArtBadge';

/**
 * One deck on someone's shelf, in the only shape this component needs.
 *
 * Deliberately NOT `DiscoverDeck`. That type carries owner attribution, like/
 * bookmark state and the card oracle ids behind the buildable meter — all of
 * which a friends-rung deck simply has no data for, and none of which mean
 * anything on a single person's page (the owner is the page). Synthesizing
 * them to reuse `DiscoverDeckTile` would fabricate facts, which is the trap
 * `buildWantRadar` was written to avoid.
 */
export interface LibraryDeck {
  /** Stable key. */
  id: string;
  /** Where the tile opens. A published deck has a slug; a friends-rung deck
   *  only ever has a share token — hence a href, not a slug. */
  href: string;
  name: string;
  format: string;
  commanderName: string | null;
  commanderImage: string | null;
  colorIdentity: string[];
  bracket: number | null;
  /** The auto-estimate, independent of `bracket` — shown alongside it
   *  whenever they differ (2026-09-24 ruling), so a stated bracket can't
   *  hide what the deck actually estimates at. Null when unavailable. */
  estimatedBracket?: number | null;
  /** `estimatedBracket` ran before the combo match answered: word it as a floor. */
  estimatedBracketFloor?: boolean;
  /** Sort key for "Recently updated" — published-at or updated-at, per caller. */
  updatedAt: number;
  /** On-art overlay (views · copies · recency). The public profile has these
   *  numbers; a friend's library does not, and omits the line entirely. */
  statsLine?: string | null;
  /** Corner badge — the friend hub marks the decks only a friend can see. */
  badge?: string | null;
}

type LibrarySortKey = 'updated' | 'name' | 'bracket';

const SORT_OPTIONS: SortMenuOption<LibrarySortKey>[] = [
  { value: 'updated', label: 'Updated', dirLabels: ['Newest', 'Oldest'] },
  { value: 'name', label: 'Name', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'bracket', label: 'Bracket', dirLabels: ['Lowest', 'Highest'] },
];

function formatLabel(format: string): string {
  return DECK_FORMAT_CONFIGS[format as DeckFormat]?.label ?? format;
}

function colorSummary(colorIdentity: string[]): string {
  if (colorIdentity.length === 0) return 'Colorless';
  return `${colorIdentity.length} color${colorIdentity.length === 1 ? '' : 's'}`;
}

/**
 * One person's browsable deck library — search, filters, sort, tiles.
 *
 * Exists because "someone else's decks" was rendered three different ways and
 * only one of them was browsable: `/decks/discover` had a commander typeahead
 * and four filters over EVERY public deck, `/u/:username` had tiles but not a
 * single control, and a friend's hub listed decks as plain text rows with a
 * "View" link. The friend case was the worst of the three — a friend saw
 * strictly less of your decks than a logged-out stranger did.
 *
 * The search box matches NAME OR COMMANDER in one field, rather than Discover's
 * separate commander typeahead: that typeahead exists to resolve a commander
 * across the whole platform, which is a different problem from finding one deck
 * on one person's shelf. Filtering is client-side because both callers already
 * hold the whole list (both endpoints cap at 200).
 */
export function DeckLibrary({
  decks,
  ariaLabel,
  emptyTagline,
  emptyHint,
  header,
  pinnedId = null,
}: {
  decks: LibraryDeck[];
  ariaLabel: string;
  /** Shown when the person has no decks at all. */
  emptyTagline: string;
  emptyHint: string;
  /** Optional content between the toolbar and the grid (e.g. a count line). */
  header?: ReactNode;
  /**
   * The deck the owner pinned. While nothing is searched or filtered it leads
   * as a larger "Pinned" tile above the grid (and is left out of the grid so
   * it never shows twice); once the viewer narrows the list it is an ordinary
   * tile, so a search still finds it.
   */
  pinnedId?: string | null;
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<DiscoverFilters>(NO_DISCOVER_FILTERS);
  const [sort, setSort] = useState<LibrarySortKey>('updated');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const kept = decks.filter((d) => {
      if (q && !`${d.name} ${d.commanderName ?? ''}`.toLowerCase().includes(q)) return false;
      if (filters.format && d.format !== filters.format) return false;
      if (
        filters.brackets.length > 0 &&
        (d.bracket == null || !filters.brackets.includes(d.bracket))
      )
        return false;
      // The same predicate Discover's server query mirrors (and the engine
      // owns), so one control can't mean two things in two places.
      if (
        filters.colors.length > 0 &&
        !colorSelectionMatches(
          d.colorIdentity.length === 0 ? 'C' : '',
          d.colorIdentity,
          new Set(filters.colors),
          filters.colorMode
        )
      )
        return false;
      return true;
    });
    const sign = dir === 'asc' ? 1 : -1;
    return [...kept].sort((a, b) => {
      if (sort === 'name') return sign * a.name.localeCompare(b.name);
      if (sort === 'bracket') {
        // A deck with no bracket sorts LAST in either direction, never as a 0 —
        // the app's standing rule for unknown sort values.
        if (a.bracket == null && b.bracket == null) return a.name.localeCompare(b.name);
        if (a.bracket == null) return 1;
        if (b.bracket == null) return -1;
        return sign * (a.bracket - b.bracket) || a.name.localeCompare(b.name);
      }
      // 'updated' ascending reads NEWEST first (see SORT_OPTIONS dirLabels).
      return sign * (b.updatedAt - a.updatedAt);
    });
  }, [decks, search, filters, sort, dir]);

  const toggleSort = (key: LibrarySortKey) => {
    if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('asc');
    }
  };

  const narrowed =
    search.trim().length > 0 ||
    filters.format != null ||
    filters.colors.length > 0 ||
    filters.brackets.length > 0;

  // A shelf of one format (most are all Commander) repeats the same chip on
  // every tile; it says nothing there, so it goes and the bracket gets the
  // room. Judged over the whole shelf, not the filtered view, so filtering to
  // a format doesn't make the chips blink out. The accessible name keeps it.
  const showFormat = new Set(decks.map((d) => d.format)).size > 1;

  const featured = !narrowed && pinnedId ? (filtered.find((d) => d.id === pinnedId) ?? null) : null;
  const gridDecks = featured ? filtered.filter((d) => d !== featured) : filtered;

  return (
    <div className="deck-library">
      <div className="deck-library-controls">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search by deck or commander"
          ariaLabel={`Search ${ariaLabel} by deck or commander`}
          className="deck-library-search"
          trailing={
            <DiscoverFiltersPopover
              filters={filters}
              onChange={setFilters}
              hideBudget
              resultLabel={resultCountLabel(filtered.length, 'deck')}
            />
          }
        />
        <SortMenu<LibrarySortKey>
          ariaLabel="Sort"
          value={sort}
          dir={dir}
          options={SORT_OPTIONS}
          onChange={toggleSort}
        />
      </div>

      {header}

      {featured && (
        <ul className="decks-index-list is-grid deck-library-featured" aria-label="Pinned deck">
          <DeckLibraryTile deck={featured} featured showFormat={showFormat} />
        </ul>
      )}

      {filtered.length === 0 ? (
        <div role="status">
          <SharedEmptyState
            empty={decks.length === 0}
            emptyTagline={emptyTagline}
            emptyHint={emptyHint}
            filteredTagline="No decks match your search or filters."
            onClearSearch={
              narrowed
                ? () => {
                    setSearch('');
                    setFilters(NO_DISCOVER_FILTERS);
                  }
                : undefined
            }
          />
        </div>
      ) : gridDecks.length === 0 ? null : (
        <ul className="decks-index-list is-grid deck-library-grid" aria-label={ariaLabel}>
          {gridDecks.map((deck) => (
            <DeckLibraryTile key={deck.id} deck={deck} showFormat={showFormat} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The tile — the `/u/:username` card, lifted so the friend hub renders exactly
 * the same thing. Same `.decks-index-card` family the owner's own deck index
 * uses, so all three read as one app.
 */
function DeckLibraryTile({
  deck,
  featured = false,
  showFormat,
}: {
  deck: LibraryDeck;
  featured?: boolean;
  showFormat: boolean;
}) {
  const colors = deck.colorIdentity.slice(0, 5);
  // Carries everything the tile shows, including the stats overlay — which is
  // `aria-hidden` on the art, so without it here a screen reader would lose the
  // view/copy counts entirely (the label this replaced on /u/:username spelled
  // them out, and dropping them would have been a silent a11y regression).
  const label = [
    deck.name,
    deck.commanderName ? `led by ${deck.commanderName}` : null,
    formatLabel(deck.format),
    colorSummary(deck.colorIdentity),
    deck.bracket != null
      ? deck.estimatedBracket != null && deck.estimatedBracket !== deck.bracket
        ? bracketAriaWithEstimate(deck.bracket, deck.estimatedBracket, deck.estimatedBracketFloor)
        : formatBracketLabel(deck.bracket)
      : null,
    deck.statsLine,
    deck.badge,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Surface
      as="li"
      variant="sleeve"
      className={`decks-index-card public-profile-tile deck-library-tile${
        featured ? ' is-featured' : ''
      }`}
    >
      <Link to={deck.href} className="decks-index-card-link" aria-label={label}>
        <span className="public-profile-tile-banner">
          {featured && (
            <ArtBadge className="deck-library-tile-badge" corner="top-start">
              Pinned
            </ArtBadge>
          )}
          {deck.commanderImage ? (
            <img
              className="decks-index-card-art"
              src={deck.commanderImage}
              alt=""
              aria-hidden="true"
              loading="lazy"
            />
          ) : (
            <span className="decks-index-card-banner" aria-hidden="true">
              {colors.length > 0 && (
                <span className="decks-index-card-banner-pips">
                  {colors.map((c) => (
                    <ColorPip key={c} color={c} />
                  ))}
                </span>
              )}
            </span>
          )}
          {deck.statsLine && (
            <span className="public-profile-tile-banner-stats" aria-hidden="true">
              {deck.statsLine}
            </span>
          )}
          {deck.badge && (
            <ArtBadge className="deck-library-tile-badge" corner="bottom-start">
              {deck.badge}
            </ArtBadge>
          )}
        </span>
        <ColorIdentityBar colors={colors} />
        <div className="decks-index-card-body">
          <div className="decks-index-card-name">
            <span>{deck.name}</span>
          </div>
          <div className="decks-index-card-meta">
            {colors.length > 0 && (
              <span className="decks-index-card-pips">
                {colors.map((c) => (
                  <ColorPip key={c} color={c} />
                ))}
              </span>
            )}
            {showFormat && <Chip className="deck-format-badge">{formatLabel(deck.format)}</Chip>}
            {deck.bracket != null && (
              <Chip className="deck-bracket-badge">
                {bracketBadge(deck.bracket, deck.estimatedBracket, deck.estimatedBracketFloor)}
              </Chip>
            )}
          </div>
          {deck.commanderName && (
            <div className="deck-library-tile-commander">{deck.commanderName}</div>
          )}
        </div>
      </Link>
    </Surface>
  );
}
