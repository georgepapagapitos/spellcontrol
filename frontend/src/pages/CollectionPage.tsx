import { BarChart3, Download, History, Plus, Share2, Trash2 } from 'lucide-react';
import { CollectionHubTabs } from '@/components/CollectionHubTabs';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAnimatedNumber } from '../lib/use-animated-number';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { getSyncState, onSyncedChange } from '../lib/sync';
import { materializeBinders } from '../lib/materialize';
import { useBinderLayoutInputs } from '../lib/use-binder-layout-inputs';
import { useAllocations } from '../lib/allocations';
import { formatMoney } from '../lib/format-money';
import { AddCardsSheet } from '../components/AddCardsSheet';
import { PageHeader } from '../components/PageHeader';
import { StatsBar } from '../components/StatsBar';
import type { CollectionFilterJump } from '../lib/collection-insights';
import { CardListTable } from '../components/CardListTable';
import { CollectionVisibilityDialog } from '../components/CollectionVisibilityDialog';
import { CollectionExportDialog } from '../components/CollectionExportDialog';
import { ImportHistorySheet } from '../components/ImportHistorySheet';
import { DeleteCollectionDialog } from '../components/DeleteCollectionDialog';
import { Button } from '@/components/shared/Button';

export function CollectionPage() {
  // BinderPage's inputs (decorated cards, allocations, set data), so the
  // table's binder column names the binder each card is actually in.
  const { cards, binders, allocatedCopyIds, setMap } = useBinderLayoutInputs();
  const hydrating = useCollectionStore((s) => s.hydrating);
  const isRefreshingPrices = useCollectionStore((s) => s.isRefreshingPrices);
  const priceRefreshProgress = useCollectionStore((s) => s.priceRefreshProgress);
  const pricesEverLoaded = useCollectionStore((s) => s.pricesEverLoaded);
  const error = useCollectionStore((s) => s.error);
  const setError = useCollectionStore((s) => s.setError);
  const authStatus = useAuth((s) => s.status);
  const [searchParams, setSearchParams] = useSearchParams();

  // Re-render on sync-state transitions. On a fresh device the local cache is
  // empty, so `hydrating` flips false with zero cards and the collection only
  // streams in afterwards via the initial server pull — without this the page
  // would flash its empty-state ("Add cards") before the cards arrive. We
  // subscribe so the syncing→ready transition (and an empty account settling)
  // re-evaluates the loading branch below.
  const [, forceSyncTick] = useState(0);
  useEffect(() => onSyncedChange(() => forceSyncTick((n) => n + 1)), []);

  // Deep-link: ?add=search|list|scan|products opens the AddCardsSheet on the
  // matching tab, with &q= seeding the Search tab's query (T153 decision C).
  // Both the open-flag and the initial tab/query are captured at mount via the
  // lazy useState initialiser so they remain stable even after the params are
  // stripped from the URL (which triggers a re-render with empty
  // searchParams). Unknown/absent-but-present ?add= values open on 'search'
  // (this is also how the pre-T153 ?add=list-only link kept working). 'scan'
  // falls back to 'search' on a device that can't scan — AddCardsSheet's own
  // `safeInitial` clamp already covers that.
  type AddTab = 'upload' | 'search' | 'product' | 'scan';
  const addTabFromParam = (v: string | null): AddTab => {
    if (v === 'list') return 'upload';
    if (v === 'scan') return 'scan';
    if (v === 'products') return 'product';
    return 'search';
  };
  const [addCardsOpen, setAddCardsOpen] = useState(() => searchParams.get('add') !== null);
  const [initialTab, setInitialTab] = useState<AddTab>(() =>
    addTabFromParam(searchParams.get('add'))
  );
  const [initialQuery, setInitialQuery] = useState<string | undefined>(
    () => searchParams.get('q') ?? undefined
  );
  const openAddCards = (tab: AddTab = 'search', query?: string) => {
    setInitialTab(tab);
    setInitialQuery(query);
    setAddCardsOpen(true);
  };

  useEffect(() => {
    // Strip one-shot params from the URL without adding a history entry, so a
    // refresh doesn't re-open what they opened: ?add (+ ?q) the Add cards
    // sheet, and Home's Your cards doors, ?stats (the Breakdown drawer) and
    // ?spares (the tradeable-surplus filter).
    const oneShot = ['add', 'q', 'stats', 'spares'];
    if (oneShot.some((k) => searchParams.get(k) !== null)) {
      const next = new URLSearchParams(searchParams);
      for (const k of oneShot) next.delete(k);
      setSearchParams(next, { replace: true });
    }
    // Run only once on mount — the param values are already captured in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [shareOpen, setShareOpen] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);

  const [statsOpen, setStatsOpen] = useState(() => searchParams.get('stats') !== null);
  // A Breakdown drawer row's filter request, relayed to CardListTable (see
  // its `filterJump` prop's doc — the two are mounted siblings, so this
  // can't go through the `?binder=`-style URL deep link).
  const [filterJump, setFilterJump] = useState<CollectionFilterJump | null>(() =>
    searchParams.get('spares') !== null ? { kind: 'surplus' } : null
  );

  const [historyOpen, setHistoryOpen] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);

  const collectionCardCount = cards.length;
  const collectionValue = useMemo(
    () => cards.reduce((sum, c) => sum + c.purchasePrice, 0),
    [cards]
  );

  // Reveal animations for the hero stats. Card count counts up on first load;
  // dollar value reveals (integer only, no pop animation wired up — popKey is
  // intentionally unused here per §8.1 of the UX-411 spec).
  const { display: displayCardCount } = useAnimatedNumber(collectionCardCount, {
    revealMs: 600,
    revealKey: 'collection-hero-count',
  });
  const { display: displayValue } = useAnimatedNumber(Math.floor(collectionValue), {
    revealMs: 600,
    revealKey: 'collection-hero-value',
  });

  const allocations = useAllocations();
  // Copies reserved by a physical cube (unavailable to decks) — surfaced in the
  // hero so the "committed elsewhere" gap has a visible home on the collection.
  const cubeReservedCount = useMemo(() => {
    let n = 0;
    for (const a of allocations.values()) if (a.ownerKind === 'cube') n += 1;
    return n;
  }, [allocations]);

  // Materialize without search — the collection table has its own local search.
  const { materialized } = useMemo(() => {
    if (cards.length === 0) return { materialized: [] };
    const result = materializeBinders(cards, binders, {
      search: '',
      allocatedCopyIds,
      setMap,
    });
    return { materialized: result.binders };
  }, [cards, binders, allocatedCopyIds, setMap]);

  const isEmpty = collectionCardCount === 0;

  // Show a loading state — not the empty "Add cards" view — while an authed
  // device is still pulling its collection from the server (the fresh-device
  // window where local hydrate found nothing). As soon as the first row lands,
  // `isEmpty` flips false and the real collection renders; a genuinely empty
  // account falls through to the empty state once sync settles to 'ready'.
  const loadingCollection =
    hydrating || (isEmpty && authStatus === 'authed' && getSyncState() === 'syncing');

  return (
    <>
      {loadingCollection ? (
        <div className="page-loader page-loader--message" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="page-loader-message">Loading your collection…</span>
        </div>
      ) : (
        <>
          {error && (
            <div className="error-banner" style={{ marginBottom: 'var(--space-4)' }}>
              {error}
              <Button
                variant="link"
                style={{ marginLeft: 'var(--space-2)' }}
                onClick={() => setError(null)}
              >
                Dismiss
              </Button>
            </div>
          )}
          {/* The collection view is the same whether or not it has cards: hero,
              search, and the grid/list always render. An empty collection just
              shows an empty-state body (with its own Add cards CTA) instead of
              a separate import screen — adding/importing happens through the
              always-present "Add cards" sheet (search · list · scan). Stats and
              Share hide when there's nothing yet to break down or share. */}
          <PageHeader
            title="Collection"
            metaClassName="collection-hero-meta"
            menuLabel="More collection actions"
            actions={[
              {
                label: 'Add cards',
                icon: Plus,
                primary: true,
                opensDialog: true,
                onClick: () => openAddCards('search'),
              },
              ...(isEmpty
                ? []
                : [
                    {
                      label: 'Export',
                      icon: Download,
                      opensDialog: true,
                      title: 'Download your collection for another tool',
                      onClick: () => setExportOpen(true),
                    },
                    {
                      label: 'Share',
                      icon: Share2,
                      opensDialog: true,
                      title: 'Choose who can see your collection',
                      onClick: () => setShareOpen(true),
                    },
                    {
                      label: 'Import history',
                      icon: History,
                      menuOnly: true,
                      opensDialog: true,
                      onClick: () => setHistoryOpen(true),
                    },
                    {
                      label: 'Delete collection',
                      icon: Trash2,
                      danger: true,
                      menuOnly: true,
                      opensDialog: true,
                      onClick: () => setDeleteOpen(true),
                    },
                  ]),
            ]}
            meta={
              <>
                <span aria-label="Collection totals">
                  {displayCardCount.toLocaleString()} {collectionCardCount === 1 ? 'card' : 'cards'}{' '}
                  ·{' '}
                  {(isRefreshingPrices && priceRefreshProgress) ||
                  (!isEmpty && !pricesEverLoaded && collectionValue === 0) ? (
                    // The prominent total must not read as a settled figure
                    // while the collection is being priced for the FIRST time —
                    // not as a real $0, and not as a partial sum either. The
                    // old guard was `collectionValue === 0`, which only held
                    // until the first chunk landed and then showed the running
                    // subtotal: measured $1,646 → $3,351 → $4,770 → $7,754 over
                    // ~60s on an 11.5k-card collection. A confident $1,646
                    // against a true $7,754 is worse than showing no number.
                    //
                    // `priceRefreshProgress` covers the in-flight chunked
                    // refresh. `pricesEverLoaded` (B3-02) covers the narrower
                    // gap BEFORE that: cards can render — via sync's initial
                    // pull, all at purchasePrice 0 — a full render or more
                    // before autoRefreshStalePrices has even decided whether a
                    // refresh is needed, which is when isRefreshingPrices was
                    // false, priceRefreshProgress was null, and this pill's
                    // predecessor confidently showed "$0" instead.
                    <span className="collection-hero-pricing" aria-live="polite">
                      <span className="sync-indicator-spinner" aria-hidden="true" />
                      {priceRefreshProgress
                        ? `Pricing ${priceRefreshProgress.done}/${priceRefreshProgress.total}…`
                        : 'Pricing…'}
                    </span>
                  ) : (
                    <span title="Current market value (Scryfall)">
                      {formatMoney(displayValue, { wholeDollars: true })}
                    </span>
                  )}
                  {cubeReservedCount > 0 && (
                    <span title="Unavailable to decks">
                      {' · '}
                      {cubeReservedCount.toLocaleString()} reserved by cubes
                    </span>
                  )}
                </span>
                {!isEmpty && (
                  <>
                    <span aria-hidden> · </span>
                    <button
                      type="button"
                      className="collection-hero-stats-link"
                      onClick={() => setStatsOpen(true)}
                      aria-label="Stats: collection breakdown"
                    >
                      <BarChart3 width={12} height={12} strokeWidth={2} aria-hidden />
                      <span>Stats</span>
                    </button>
                  </>
                )}
              </>
            }
          />
          <CollectionHubTabs />
          <CardListTable
            cards={cards}
            binders={materialized}
            setMap={setMap}
            onAddCards={(query) => openAddCards('search', query)}
            filterJump={filterJump}
            onFilterJumpApplied={() => setFilterJump(null)}
          />
          <StatsBar
            open={statsOpen}
            cards={cards}
            binderDefs={binders}
            onClose={() => setStatsOpen(false)}
            onFilterJump={setFilterJump}
          />
          {exportOpen && (
            <CollectionExportDialog cards={cards} onClose={() => setExportOpen(false)} />
          )}
          {shareOpen && <CollectionVisibilityDialog onClose={() => setShareOpen(false)} />}
          {historyOpen && <ImportHistorySheet onClose={() => setHistoryOpen(false)} />}
          {deleteOpen && <DeleteCollectionDialog onClose={() => setDeleteOpen(false)} />}
        </>
      )}

      {addCardsOpen && (
        <AddCardsSheet
          initialTab={initialTab}
          initialQuery={initialQuery}
          onClose={() => setAddCardsOpen(false)}
        />
      )}
    </>
  );
}
