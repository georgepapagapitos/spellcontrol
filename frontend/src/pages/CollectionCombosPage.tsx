import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComboMatch } from '../types/combos';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { getSyncState, onSyncedChange } from '../lib/sync';
import { buildCardImageIndex, buildCardIndex } from '../lib/deck-card-index';
import { useDeckCombos } from '../lib/use-deck-combos';
import { BrandMark } from '../components/shared/BrandMark';
import { CardPreview } from '../components/CardPreview';
import { Tabs } from '../components/Tabs';
import { SearchPill } from '../components/SearchPill';
import { ComboFiltersPopover } from '../components/ComboFiltersPopover';
import { ComboRow } from '../components/deck/ComboRow';
import { ComboCollectionAside } from '../components/deck/ComboCollectionAside';
import { useComboPreview } from '../components/deck/use-combo-preview';
import { useMissingCardPrices } from '../components/deck/use-missing-prices';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { buildCardLocationIndex } from '../lib/card-locations';
import {
  commandersForIdentity,
  hasHostForIdentity,
  ownedCommanders,
  rankHosts,
} from '../lib/combo-hosts';
import { emptyComboFilters, filterCombos, countActiveFilters } from '../lib/combo-filters';

type Tab = 'complete' | 'oneAway';

/**
 * Collection-wide combo discovery — "what can the cards I physically own
 * already do?", independent of any deck.
 *
 * This runs the same `/api/combos/match` endpoint the deck panel uses, but
 * deliberately sends NO deck. That switches the matcher (backend
 * `combos/match.ts`) into its collection branch, which buckets by ownership
 * instead of deck membership:
 *
 *   - `inDeck`             → every piece owned  ("Complete" here)
 *   - `almostInCollection` → own all but one    ("One away" here)
 *   - `oneAway`            → always empty without a deck
 *
 * The field names read oddly in this context, but they're the matcher's
 * existing contract (mirrored in the offline port), so the relabelling happens
 * here in the UI rather than by renaming across both copies.
 */
export function CollectionCombosPage() {
  const collection = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const authStatus = useAuth((s) => s.status);

  // Mirrors CollectionPage: on a fresh device the local cache is empty, so
  // `hydrating` flips false with zero cards while the server pull is still
  // streaming in. Without this the page would flash its empty state.
  const [, forceSyncTick] = useState(0);
  useEffect(() => onSyncedChange(() => forceSyncTick((n) => n + 1)), []);

  const ownedOracleIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const c of collection) if (c.oracleId) ids.add(c.oracleId);
    return ids;
  }, [collection]);
  const ownedOracleIds = useMemo(() => Array.from(ownedOracleIdSet), [ownedOracleIdSet]);

  // No deck anywhere on this surface — hence `null` to the index builders and
  // an empty deck list to the matcher.
  const cardImageIndex = useMemo(() => buildCardImageIndex(collection, null), [collection]);
  const cardIndex = useMemo(() => buildCardIndex(collection, null), [collection]);
  const preview = useComboPreview(cardIndex);

  // Both derivations are pure and local — computed once for the whole page,
  // not per row, so a few hundred combo rows add no requests and no rescans.
  const commanders = useMemo(() => ownedCommanders(collection), [collection]);
  const locations = useMemo(
    () => buildCardLocationIndex(collection, binders),
    [collection, binders]
  );

  const { data, loading, error, refetch } = useDeckCombos({
    deckOracleIds: [],
    ownedOracleIds,
    format: 'commander',
  });

  // E212: `source: 'server'` means the device-local combo dataset couldn't be
  // cached, so this went through the server matcher instead — which caps
  // candidates at 2000 for memory safety and can under-report a collection
  // this size. Never present that silently as the final answer.
  const partial = data?.source === 'server';

  // Memoized because the `?? []` fallback would otherwise mint a fresh array
  // identity every render, invalidating every downstream filter memo.
  const rawComplete = useMemo(() => data?.inDeck ?? [], [data?.inDeck]);
  const rawOneAway = useMemo(() => data?.almostInCollection ?? [], [data?.almostInCollection]);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [filters, setFilters] = useState(emptyComboFilters);

  // A combo is hostable if any owned commander's identity covers it — the same
  // derivation the per-row aside shows, reused as a filter predicate.
  const canHost = useCallback(
    (m: ComboMatch) => hasHostForIdentity(commanders, m.combo.identity),
    [commanders]
  );

  const opts = useMemo(() => ({ search: debouncedSearch, canHost }), [debouncedSearch, canHost]);
  const complete = useMemo(
    () => filterCombos(rawComplete, filters, opts),
    [rawComplete, filters, opts]
  );
  const oneAway = useMemo(
    () => filterCombos(rawOneAway, filters, opts),
    [rawOneAway, filters, opts]
  );

  const [tab, setTab] = useState<Tab>('complete');
  const matches = tab === 'complete' ? complete : oneAway;

  // Prices for the missing pieces. Only the one-away tab has any, and only
  // while it's the tab being looked at — no point fetching for a list the user
  // isn't on. The missing card is never in the collection, so these can't come
  // from local data (see useMissingCardPrices).
  const missingNames = useMemo(() => {
    if (tab !== 'oneAway') return [];
    const names: string[] = [];
    for (const m of oneAway) {
      const id = m.missingOracleIds[0];
      const card = id ? m.combo.cards.find((c) => c.oracleId === id) : undefined;
      if (card) names.push(card.cardName);
    }
    return names;
  }, [tab, oneAway]);
  const missingPrices = useMissingCardPrices(missingNames);

  const priceFor = (m: ComboMatch): number | undefined => {
    const id = m.missingOracleIds[0];
    const card = id ? m.combo.cards.find((c) => c.oracleId === id) : undefined;
    return card ? missingPrices.get(card.cardName.toLowerCase()) : undefined;
  };

  // Distinguishes "you own no combos" from "your filters hid them all" — the
  // empty state has to say which, or it reads as a broken page.
  const narrowed = debouncedSearch.trim().length > 0 || countActiveFilters(filters) > 0;
  const rawTotal = rawComplete.length + rawOneAway.length;

  const hasCollection = ownedOracleIds.length > 0;
  const loadingCollection =
    hydrating ||
    (collection.length === 0 && authStatus === 'authed' && getSyncState() === 'syncing');

  if (loadingCollection) {
    return (
      <div className="page-loader page-loader--message" role="status" aria-live="polite">
        <BrandMark size={64} motion="busy" aria-hidden />
        <span className="page-loader-message">Loading your collection…</span>
      </div>
    );
  }

  return (
    <>
      <header className="binder-hero collection-hero">
        <div className="collection-hero-text">
          <h1 className="binder-hero-name">Combos</h1>
          <p className="binder-hero-meta collection-hero-meta">
            <span>
              {loading
                ? 'Checking your collection…'
                : `${complete.length.toLocaleString()} complete · ${oneAway.length.toLocaleString()} one away`}
            </span>
          </p>
        </div>
      </header>

      {partial && (
        <div className="deck-combos-partial-banner" role="status" aria-live="polite">
          <span>
            Showing partial results — your device couldn&rsquo;t load the full combo dataset, so
            some combos may be missing.
          </span>
          <button type="button" className="btn-link" onClick={refetch} disabled={loading}>
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {rawTotal > 0 && (
        <div className="combos-search-row">
          <SearchPill
            value={search}
            onChange={setSearch}
            placeholder="Search combos"
            ariaLabel="Search combos by card name or result"
            trailing={
              <ComboFiltersPopover
                filters={filters}
                setFilters={setFilters}
                hasCommanders={commanders.length > 0}
              />
            }
          />
        </div>
      )}

      <div className="deck-combos-panel is-embedded" role="region" aria-label="Collection combos">
        <div className="deck-combos-body">
          <Tabs
            ariaLabel="Combo bucket"
            variant="scrollable"
            className="combos-page-tabs"
            value={tab}
            onChange={setTab}
            tabs={[
              {
                id: 'complete',
                label: 'Complete',
                count: complete.length,
                ariaLabel: `Complete, ${complete.length} combos`,
              },
              {
                id: 'oneAway',
                label: 'One card away',
                count: oneAway.length,
                ariaLabel: `One card away, ${oneAway.length} combos`,
              },
            ]}
          />

          {error && <p className="deck-combos-empty deck-combos-error">{error}</p>}

          {loading && matches.length === 0 && (
            <p className="deck-combos-empty" role="status" aria-live="polite">
              Checking your collection against the combo database…
            </p>
          )}

          {!error && !loading && matches.length === 0 && (
            <div className="deck-combos-empty">
              {!hasCollection ? (
                <p>Add cards to your collection to see which combos you can already build.</p>
              ) : narrowed ? (
                // The collection DOES have matches — the search/filters hid
                // them. Saying "no combos" here would read as a broken page.
                <>
                  <p>No combos match your search and filters.</p>
                  <p className="deck-combos-empty-secondary">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        setSearch('');
                        setFilters(emptyComboFilters());
                      }}
                    >
                      Clear search and filters
                    </button>
                  </p>
                </>
              ) : tab === 'complete' ? (
                <>
                  <p>No combos you can build outright yet.</p>
                  {oneAway.length > 0 && (
                    <p className="deck-combos-empty-secondary">
                      {oneAway.length === 1
                        ? '1 combo is one card away — check the next tab.'
                        : `${oneAway.length} combos are one card away — check the next tab.`}
                    </p>
                  )}
                </>
              ) : (
                <p>No combos one card away — try expanding your collection.</p>
              )}
            </div>
          )}

          {!error && matches.length > 0 && (
            <ul className="deck-combos-list" role="list">
              {matches.map((match) => (
                <ComboRow
                  key={match.combo.id}
                  match={match}
                  isOneAway={tab === 'oneAway'}
                  scope="collection"
                  edhrec={null}
                  cardImageIndex={cardImageIndex}
                  ownedOracleIds={ownedOracleIdSet}
                  onCardTap={(tapped) => void preview.open(match.combo.cards, tapped)}
                  missingPrice={tab === 'oneAway' ? priceFor(match) : undefined}
                  aside={
                    <ComboCollectionAside
                      cards={match.combo.cards}
                      hosts={rankHosts(commandersForIdentity(commanders, match.combo.identity))}
                      locations={locations}
                    />
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {preview.cards && preview.cards.length > 0 && (
        <CardPreview
          source="suggestion"
          showRole
          cards={preview.cards}
          index={preview.index}
          binderName={preview.title}
          sectionLabels={preview.cards.map(() => 'Combo')}
          pageNumbers={preview.cards.map(() => 0)}
          totalPages={1}
          onIndexChange={preview.setIndex}
          onClose={preview.close}
        />
      )}
    </>
  );
}
