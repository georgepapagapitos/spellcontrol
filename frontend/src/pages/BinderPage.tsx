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
import { AddCardSheet } from '../components/AddCardSheet';
import { BackLink } from '../components/BackLink';
import { OverflowMenu } from '../components/OverflowMenu';

const BinderCardEditor = lazy(() =>
  import('../components/BinderCardEditor').then((m) => ({ default: m.BinderCardEditor }))
);
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { findRedundantPins } from '../lib/binder-pin-dissolve';
import { useCardsWithTags, bindersUseTags } from '../lib/card-tags';
import { useAllocations } from '../lib/allocations';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { BinderTabs } from '../components/BinderTabs';
import { BinderView } from '../components/BinderView';
import { BinderListView } from '../components/BinderListView';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SearchPill } from '../components/SearchPill';
import { FilterPopover } from '../components/FilterPopover';
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
  const cards = useCardsWithTags(rawCards, bindersUseTags(binders));
  const hydrating = useCollectionStore((s) => s.hydrating);
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
  const [groupPrintings, setGroupPrintings] = useState(false);

  // Debounce the value materialize() sees so each keystroke doesn't trigger a
  // full filter/sort/group pass over the whole collection. The input itself
  // still reflects live keystrokes via the un-debounced `search`.
  const debouncedSearch = useDebouncedValue(search, 180);

  // When "group printings" is on we collapse multiple copies of the same
  // (scryfallId, foil) into a single representative copy and remember the
  // total via qtyByCopyId. The materializer then lays out unique
  // printings; CardSlot paints a ×N badge on slots with qty > 1.
  const { effectiveCards, qtyByCopyId } = useMemo(() => {
    if (!groupPrintings) return { effectiveCards: cards, qtyByCopyId: undefined };
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
    return { effectiveCards: deduped, qtyByCopyId: qtyMap };
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
    }).binders;
  }, [effectiveCards, binders, debouncedSearch, allocatedCopyIds, setMap]);

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
    }).binders;
  }, [materialized, debouncedSearch, effectiveCards, binders, allocatedCopyIds, setMap]);

  // Computed before the early returns below (Rules of Hooks: the dissolve
  // effect that depends on it must run unconditionally on every render).
  // Mirrors the `active`/`activeId` derivation used after the early returns.
  const active = materialized.find((b) => b.def.id === routeId) ?? materialized[0];
  const activeId = active?.def.id ?? null;

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

  if (hydrating) {
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
        <header
          className="binder-hero binder-hero--with-actions"
          style={{ ['--binder-color' as string]: active.def.color }}
        >
          <div className="binder-hero-text">
            <h1 className="binder-hero-name">{active.def.name}</h1>
            <p className="binder-hero-meta">
              {active.def.fixedCapacity != null ? (
                <>
                  {active.totalCards.toLocaleString()} / {active.def.fixedCapacity.toLocaleString()}{' '}
                  cards · {active.totalPages.toLocaleString()} /{' '}
                  {Math.ceil(
                    active.def.fixedCapacity / active.effectivePocketSize
                  ).toLocaleString()}{' '}
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
                  {active.totalCards.toLocaleString()} {active.totalCards === 1 ? 'card' : 'cards'}{' '}
                  · {active.totalPages.toLocaleString()}{' '}
                  {active.totalPages === 1 ? 'page' : 'pages'}
                </>
              )}
            </p>
          </div>
          <div className="binder-hero-actions">
            {/* Secondary actions: full pills on desktop/tablet,
                collapsed into the ⋮ kebab on phones so the primary
                "Add card" CTA never gets crowded off the row. */}
            <button
              type="button"
              className="pill-btn binder-hero-action-secondary"
              aria-haspopup="dialog"
              onClick={() => setCardEditorOpen(true)}
              disabled={!activeId}
            >
              <ListChecks width={14} height={14} strokeWidth={1.6} aria-hidden />
              <span>Manage cards</span>
            </button>
            <button
              type="button"
              className="pill-btn binder-hero-action-secondary"
              aria-haspopup="dialog"
              onClick={() => activeId && setEditingBinder(activeId)}
              disabled={!activeId}
            >
              <Pencil width={14} height={14} strokeWidth={1.6} aria-hidden />
              <span>Binder rules</span>
            </button>
            <button
              type="button"
              className="pill-btn binder-hero-action-secondary"
              aria-haspopup="dialog"
              onClick={() => setShareOpen(true)}
              disabled={!activeId}
            >
              <Share2 width={14} height={14} strokeWidth={1.6} aria-hidden />
              <span>Share</span>
            </button>
            <OverflowMenu
              className="binder-hero-actions-overflow"
              triggerClassName="pill-btn binder-hero-actions-kebab"
              ariaLabel="More binder actions"
              items={[
                {
                  label: 'Manage cards',
                  icon: ListChecks,
                  onClick: () => setCardEditorOpen(true),
                },
                {
                  label: 'Binder rules',
                  icon: Pencil,
                  onClick: () => activeId && setEditingBinder(activeId),
                },
                {
                  label: 'Share',
                  icon: Share2,
                  onClick: () => setShareOpen(true),
                },
                {
                  label: 'Delete binder',
                  icon: Trash2,
                  danger: true,
                  onClick: async () => {
                    if (!active) return;
                    const ok = await confirm({
                      title: `Delete "${active.def.name}"?`,
                      body: `Its cards will be re-routed through your other binders. Anything that does not match a remaining binder will only show up in the Collection view.`,
                      confirmLabel: 'Delete binder',
                      danger: true,
                    });
                    if (ok) deleteBinder(active.def.id);
                  },
                },
              ]}
            />
            {/* Primary CTA — always visible */}
            <button
              type="button"
              className="pill-btn pill-btn-primary"
              aria-haspopup="dialog"
              onClick={() => setAddCardSheetOpen(true)}
              disabled={!activeId}
            >
              <Plus width={14} height={14} strokeWidth={1.6} aria-hidden />
              <span>Add card</span>
            </button>
          </div>
        </header>
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
            Cards are in your custom order. Open "Manage cards" → Order tab to change.
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
            <FilterPopover
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
                    ]
                  : []),
                {
                  key: 'group-printings',
                  label: 'Group printings',
                  value: groupPrintings,
                  onChange: setGroupPrintings,
                },
              ]}
            />
          }
        />
      </div>
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
          // BinderListView preserves the binder's section grouping (the same
          // White / Blue / Multicolor / etc. headers as the page grid view)
          // and rolls duplicate copies into qty pills.
          return (
            <BinderListView
              binder={active}
              viewToggle={viewToggle}
              qtyByCopyId={qtyByCopyId}
              density={view === 'compact' ? 'compact' : 'detail'}
            />
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
      {confirmDialog}
    </>
  );
}
