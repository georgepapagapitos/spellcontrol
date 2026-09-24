import {
  AlignJustify,
  LayoutGrid,
  List as ListIconLucide,
  ListChecks,
  Pencil,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { getSyncState, hasSyncError, onSyncedChange } from '../lib/sync';
import { useDocumentTitle } from '../lib/use-document-title';
import { AddCardSheet } from '../components/AddCardSheet';
import { PageHeader } from '../components/PageHeader';
import { BackLink } from '../components/BackLink';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';

const BinderCardEditor = lazy(() =>
  import('../components/BinderCardEditor').then((m) => ({ default: m.BinderCardEditor }))
);
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { findRedundantPins } from '../lib/binder-pin-dissolve';
import { useCardsWithTags, bindersUseTags } from '../lib/card-tags';
import { useCardsWithSldDrops, bindersUseSldDrops } from '../lib/sld-drops';
import { useCardsWithReleaseDates, bindersUseReleaseDates } from '../lib/card-release-dates';
import { buildQtyByPrintingKey } from '../lib/sorting';
import { useAllocations } from '../lib/allocations';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { BinderTabs } from '../components/BinderTabs';
import { BinderDriftBanner } from '../components/BinderDriftBanner';
import { BinderView } from '../components/BinderView';
import { BinderListView } from '../components/BinderListView';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SearchPill } from '../components/SearchPill';
import { FilterChipsRow } from '../components/shared/FilterChipsRow';
import { ViewOptionsPopover } from '../components/ViewOptionsPopover';
import { useSetMap } from '../lib/api';
import { useConfirm } from '../lib/use-confirm';
import { useStoredView } from '../lib/use-stored-view';
import { ShareDialog } from '../components/ShareDialog';

type BinderViewMode = 'pages' | 'list' | 'compact';

export function BinderPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const rawCards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  // Decorate with Scryfall oracle tags so "tag IS mana-rock" rules resolve.
  // No-op (returns rawCards by reference) unless a binder uses a tag rule.
  const taggedCards = useCardsWithTags(rawCards, bindersUseTags(binders));
  // Decorate with the Secret Lair drop each printing came from, so the set sorts
  // can section by drop. Same deal: no-op unless a binder sorts by set.
  const droppedCards = useCardsWithSldDrops(taggedCards, bindersUseSldDrops(binders));
  // Decorate with each printing's OWN release date, so a Release-date sort
  // dates a rolling container set (SLD/PLST/PRM/SLP/SLC) per printing instead
  // of from the set. No-op unless a binder sorts by release date, or until the
  // price refresh has cached dates for this device.
  const cards = useCardsWithReleaseDates(droppedCards, bindersUseReleaseDates(binders));
  const hydrating = useCollectionStore((s) => s.hydrating);
  // A signed-in device that has never cached this account still has an EMPTY
  // local store when `hydrating` flips false — that flag only covers reading
  // IndexedDB, and on a fresh browser there is nothing in it. The account's
  // rows arrive later, from the first pull. Without this, the empty-state
  // redirect below fires in that window and a binder deep link lands on the
  // index instead of the binder (measured: bounced in under 0.7s on a cold
  // context; the same id opened fine once the cache was warm).
  const isAuthed = useAuth((s) => s.status === 'authed');
  const [, forceSyncRender] = useState(0);
  useEffect(() => onSyncedChange(() => forceSyncRender((n) => n + 1)), []);
  // CollectionPage:124 carries the sibling of this guard and waits only on
  // `=== 'syncing'`. This one also covers the 'idle' window before startSync
  // has set 'syncing', because the stakes differ: there the choice is between
  // a loader and an empty state, here it is between a loader and navigating
  // the user away from the page they asked for.
  // `hasSyncError()` is the bail: a pull that fails leaves the state at
  // 'syncing' forever, and waiting on it would spin instead of falling back to
  // the pre-existing behaviour.
  const awaitingFirstPull = isAuthed && getSyncState() !== 'ready' && !hasSyncError();
  const search = useCollectionStore((s) => s.search);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const setSearch = useCollectionStore((s) => s.setSearch);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);
  const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Sync the URL param into the existing activeTab store field so child
  // components (BinderTabs, BinderView, BinderListView) keep working
  // without each one needing to read useParams.
  useEffect(() => {
    if (routeId) setActiveTab(routeId);
  }, [routeId, setActiveTab]);

  const [cardEditorOpen, setCardEditorOpen] = useState(false);
  const [addCardSheetOpen, setAddCardSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [view, setView] = useStoredView<BinderViewMode>(
    'mtg-binder-view-mode',
    ['pages', 'list', 'compact'],
    'pages'
  );
  const [showImages, setShowImagesRaw] = useState(() => {
    try {
      // On by default — only an explicit persisted opt-out turns it off.
      return localStorage.getItem('mtg-binder-show-images') !== 'false';
    } catch {
      /* ignore */
    }
    return true;
  });
  const setShowImages = (v: boolean) => {
    setShowImagesRaw(v);
    try {
      localStorage.setItem('mtg-binder-show-images', String(v));
    } catch {
      /* ignore */
    }
  };
  // Page-grid only: collapsing copies before materializing changes the page
  // count and every page number, which is the point in the grid (one pocket
  // per printing) and a lie in the list, whose rows exist to say where a
  // card physically sits. The list collapses identical copies itself.
  const [groupPrintingsPref, setGroupPrintings] = useState(false);
  const groupPrintings = view === 'pages' && groupPrintingsPref;

  // Debounce the value materialize() sees so each keystroke doesn't trigger a
  // full filter/sort/group pass over the whole collection. The input itself
  // still reflects live keystrokes via the un-debounced `search`.
  const debouncedSearch = useDebouncedValue(search, 180);

  // When "group printings" is on we collapse multiple copies of the same
  // (scryfallId, foil) into a single representative copy and remember the
  // total via qtyByCopyId. The materializer then lays out unique
  // printings; CardSlot paints a ×N badge on slots with qty > 1.
  const { effectiveCards, qtyByCopyId, qtyByPrintingKey } = useMemo(() => {
    if (!groupPrintings)
      return { effectiveCards: cards, qtyByCopyId: undefined, qtyByPrintingKey: undefined };
    const seen = new Map<string, { card: (typeof cards)[number]; qty: number }>();
    for (const c of cards) {
      const key = `${c.scryfallId}:${c.finish ?? (c.foil ? 'foil' : 'nonfoil')}`;
      const existing = seen.get(key);
      if (existing) existing.qty += 1;
      else seen.set(key, { card: c, qty: 1 });
    }
    const qtyMap = new Map<string, number>();
    const deduped = [...seen.values()].map(({ card, qty }) => {
      qtyMap.set(card.copyId, qty);
      return card;
    });
    // The materializer counts copies per printing for the Quantity sort from the
    // cards it is handed — one each after this collapse — so hand it the real
    // per-printing totals or "Most copies first" sorts nothing in grouped view.
    return {
      effectiveCards: deduped,
      qtyByCopyId: qtyMap,
      qtyByPrintingKey: buildQtyByPrintingKey(cards),
    };
  }, [cards, groupPrintings]);

  const allocations = useAllocations();
  const allocatedCopyIds = useMemo(() => new Set(allocations.keys()), [allocations]);
  const setMap = useSetMap();

  const materialized = useMemo(() => {
    if (effectiveCards.length === 0) return [];
    return materializeBinders(effectiveCards, binders, {
      search: debouncedSearch,
      allocatedCopyIds,
      setMap,
      qtyByPrintingKey,
    }).binders;
  }, [effectiveCards, binders, debouncedSearch, allocatedCopyIds, setMap, qtyByPrintingKey]);

  // Drift ("since last reviewed") compares full binder membership against the
  // baseline snapshot, so it must ignore the in-binder search filter — otherwise
  // searched-out cards look "no longer matching". Reuse `materialized` when no
  // query is active; only do a second, search-free pass while one narrows the view.
  const driftBinders = useMemo(() => {
    if (!debouncedSearch.trim()) return materialized;
    if (effectiveCards.length === 0) return [];
    return materializeBinders(effectiveCards, binders, {
      search: '',
      allocatedCopyIds,
      setMap,
      qtyByPrintingKey,
    }).binders;
  }, [
    materialized,
    debouncedSearch,
    effectiveCards,
    binders,
    allocatedCopyIds,
    setMap,
    qtyByPrintingKey,
  ]);

  // Computed before the early returns below (Rules of Hooks: the dissolve
  // effect that depends on it must run unconditionally on every render).
  // Mirrors the `active`/`activeId` derivation used after the early returns.
  const active = materialized.find((b) => b.def.id === routeId) ?? materialized[0];
  const activeId = active?.def.id ?? null;
  // Names the browser print job / tab title for the printable checklist.
  useDocumentTitle(active?.def.name);

  // Printable checklist source: same section grouping as BinderListView,
  // duplicate copies rolled into a Quantity like its qty pills do.
  const printGroups = useMemo(() => {
    if (!active) return [];
    return active.sections.map((section) => {
      const rows = new Map<
        string,
        { name: string; setCode: string; collectorNumber: string; qty: number }
      >();
      for (const card of section.cards) {
        const key = `${card.name}|${card.setCode}|${card.collectorNumber}|${card.finish}`;
        const existing = rows.get(key);
        if (existing) existing.qty += 1;
        else
          rows.set(key, {
            name: card.name,
            setCode: card.setCode,
            collectorNumber: card.collectorNumber,
            qty: 1,
          });
      }
      return { label: section.label, rows: [...rows.values()] };
    });
  }, [active]);

  // Pin auto-dissolve: a "Keep it here" pin that no longer does any work (the
  // card would route here via rules/other pins anyway) is silently dropped.
  // Runs off the raw `cards` (not `effectiveCards`, which collapses printings
  // under group-printings mode) since pins are per physical copyId. Guarded
  // so it only fires — and only mutates — when a redundant pin actually
  // exists; the mutation changes `binders`, which naturally converges next
  // render because the dissolved pin is gone from pinnedCopyIds by then.
  useEffect(() => {
    if (!activeId) return;
    const redundant = findRedundantPins(activeId, cards, binders);
    for (const copyId of redundant) removeCardFromBinder(activeId, copyId, false);
  }, [activeId, cards, binders, removeCardFromBinder]);

  // `hydrating` covers reading the local cache; `awaitingFirstPull` covers the
  // window after that where a signed-in device's rows are still on their way.
  // Both must clear before the empty-state redirect below can be trusted.
  if (hydrating || (awaitingFirstPull && binders.length === 0)) {
    return (
      <div className="page-loader" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span className="visually-hidden">Loading</span>
      </div>
    );
  }

  // No binders or no cards → the index page owns those empty states.
  // Send users back to /binders, where they get the right call-to-action.
  if (binders.length === 0 || cards.length === 0) {
    return <Navigate to="/collection/binders" replace />;
  }

  // Route param points at a binder that doesn't exist (deleted, bookmark
  // gone stale, typo). Bounce to the index rather than rendering empty.
  if (routeId && !binders.some((b) => b.id === routeId)) {
    return <Navigate to="/collection/binders" replace />;
  }

  // Rendered next to "Collapse all" inside each view's summary line so the
  // mode toggle sits adjacent to the content it switches between.
  const viewToggle = (
    <ViewModeToggle<'pages' | 'list' | 'compact'>
      ariaLabel="Binder view mode"
      value={view}
      onChange={setView}
      options={[
        {
          value: 'pages',
          label: 'Pages view',
          icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
        },
        {
          value: 'list',
          label: 'List view (with thumbnails)',
          icon: <ListIconLucide width={14} height={14} strokeWidth={2} aria-hidden />,
        },
        {
          value: 'compact',
          label: 'Compact list (text only)',
          icon: <AlignJustify width={14} height={14} strokeWidth={2} aria-hidden />,
        },
      ]}
    />
  );

  return (
    <>
      <BackLink to="/collection/binders" label="All binders" />
      <BinderTabs binders={materialized} />
      {active && (
        <PageHeader
          title={active.def.name}
          style={{ ['--binder-color' as string]: active.def.color }}
          menuLabel="More binder actions"
          actions={[
            {
              label: 'Add card',
              icon: Plus,
              primary: true,
              opensDialog: true,
              disabled: !activeId,
              onClick: () => setAddCardSheetOpen(true),
            },
            {
              label: 'Manage cards',
              icon: ListChecks,
              opensDialog: true,
              disabled: !activeId,
              onClick: () => setCardEditorOpen(true),
            },
            {
              label: 'Binder rules',
              icon: Pencil,
              opensDialog: true,
              disabled: !activeId,
              onClick: () => activeId && setEditingBinder(activeId),
            },
            {
              label: 'Share',
              icon: Share2,
              opensDialog: true,
              disabled: !activeId,
              onClick: () => setShareOpen(true),
            },
            {
              label: 'Delete binder',
              icon: Trash2,
              danger: true,
              menuOnly: true,
              onClick: async () => {
                const ok = await confirm({
                  title: `Delete "${active.def.name}"?`,
                  body: `Its cards route to your other binders. Anything that no longer matches falls back to the Collection view. This can't be undone.`,
                  confirmLabel: 'Delete binder',
                  danger: true,
                });
                if (ok) deleteBinder(active.def.id);
              },
            },
          ]}
          meta={
            active.def.fixedCapacity != null ? (
              <>
                {active.totalCards.toLocaleString()} / {active.def.fixedCapacity.toLocaleString()}{' '}
                cards · {active.totalPages.toLocaleString()} /{' '}
                {Math.ceil(active.def.fixedCapacity / active.effectivePocketSize).toLocaleString()}{' '}
                pages
                {active.totalCards > active.def.fixedCapacity && (
                  <span
                    className="binder-summary-overcap"
                    title={`Over capacity by ${(active.totalCards - active.def.fixedCapacity).toLocaleString()} cards`}
                  >
                    {' '}
                    ⚠ over capacity
                  </span>
                )}
              </>
            ) : (
              <>
                {active.totalCards.toLocaleString()} {active.totalCards === 1 ? 'card' : 'cards'} ·{' '}
                {active.totalPages.toLocaleString()} {active.totalPages === 1 ? 'page' : 'pages'}
              </>
            )
          }
        />
      )}
      {shareOpen && activeId && active && (
        <ShareDialog
          kind="binder"
          resourceId={activeId}
          resourceLabel={active.def.name}
          onClose={() => setShareOpen(false)}
        />
      )}
      {active?.def.manualOrder?.length ? (
        <div className="binder-manual-order-bar">
          <span className="sort-mode-badge">Manual order active</span>
          <span className="binder-manual-order-hint">
            Cards are in your custom order. Open “Manage cards” → Order tab to change.
          </span>
        </div>
      ) : null}
      <div className="binder-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search"
          ariaLabel="Search cards by name"
          trailing={
            <ViewOptionsPopover
              ariaLabel="Binder options"
              toggles={[
                ...(view === 'pages'
                  ? [
                      {
                        key: 'show-images',
                        label: 'Show card images',
                        value: showImages,
                        onChange: setShowImages,
                        // On by default — only badge it when the user
                        // has actively turned card images off.
                        defaultValue: true,
                      },
                      {
                        key: 'group-printings',
                        label: 'Group printings',
                        value: groupPrintings,
                        onChange: setGroupPrintings,
                      },
                    ]
                  : []),
              ]}
            />
          }
        />
      </div>
      <FilterChipsRow
        chips={
          search.trim()
            ? [{ id: 'search', label: `"${search.trim()}"`, onClear: () => setSearch('') }]
            : []
        }
        onClearAll={() => setSearch('')}
      />
      {view === 'pages' ? (
        <BinderView
          binders={materialized}
          driftBinders={driftBinders}
          viewToggle={viewToggle}
          qtyByCopyId={qtyByCopyId}
          showImages={showImages}
        />
      ) : (
        (() => {
          if (!active) return null;
          // Same empty state BinderView (pages mode) shows for a binder whose
          // rules currently match nothing — list/compact used to render just
          // the toolbar with no content and no explanation below it.
          if (active.totalCards === 0) {
            return (
              <div className="empty-state">
                <EmptyStateMark />
                <p className="empty-state-tagline">No cards match this binder's rules.</p>
                <p className="empty-state-hint">
                  Loosen a rule or add another match group, and cards from your collection file in
                  here.
                </p>
                <div className="empty-state-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setEditingBinder(active.def.id)}
                  >
                    Binder rules
                  </button>
                </div>
              </div>
            );
          }
          // BinderListView preserves the binder's section grouping (the same
          // White / Blue / Multicolor / etc. headers as the page grid view)
          // and rolls duplicate copies into qty pills.
          return (
            <>
              {/* Same review-queue banner the pages view mounts (BinderView) —
                  drift reads full membership, so use the search-free set. */}
              <BinderDriftBanner
                binder={driftBinders.find((b) => b.def.id === active.def.id) ?? active}
              />
              <BinderListView
                binder={active}
                viewToggle={viewToggle}
                qtyByCopyId={qtyByCopyId}
                density={view === 'compact' ? 'compact' : 'detail'}
              />
            </>
          );
        })()
      )}
      <Suspense fallback={null}>
        {cardEditorOpen && active && (
          <BinderCardEditor
            binder={active}
            allCards={cards}
            onClose={() => setCardEditorOpen(false)}
          />
        )}
      </Suspense>
      {addCardSheetOpen && active && (
        <AddCardSheet
          binderId={active.def.id}
          binderName={active.def.name}
          onClose={() => setAddCardSheetOpen(false)}
        />
      )}
      {/* Print-only checklist (name/qty/set-cn), grouped like the binder's
          own sections. Invisible on screen (styles/print.css's
          `.print-list`); BinderExportDialog's "Print checklist" action
          closes itself and calls window.print(). */}
      <div className="print-list" aria-hidden>
        <h1 className="print-list-title">{active?.def.name ?? 'Binder'}</h1>
        {printGroups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <section key={g.label} className="print-list-section">
              <h2 className="print-list-section-title">{g.label}</h2>
              <ul>
                {g.rows.map((row) => (
                  <li key={`${row.name}|${row.setCode}|${row.collectorNumber}`}>
                    <span className="print-list-qty">{row.qty}</span>
                    <span className="print-list-name">{row.name}</span>
                    <span className="print-list-printing">
                      {row.setCode.toUpperCase()} {row.collectorNumber}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
      {confirmDialog}
    </>
  );
}
