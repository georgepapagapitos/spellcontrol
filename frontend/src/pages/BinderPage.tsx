import {
  AlignJustify,
  LayoutGrid,
  List as ListIconLucide,
  ListChecks,
  Pencil,
  Plus,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AddCardSheet } from '../components/AddCardSheet';
import { BackLink } from '../components/BackLink';

const BinderCardEditor = lazy(() =>
  import('../components/BinderCardEditor').then((m) => ({ default: m.BinderCardEditor }))
);
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
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

type BinderViewMode = 'pages' | 'list' | 'compact';

const BINDER_VIEW_KEY = 'mtg-binder-view-mode';

function readStoredBinderView(): BinderViewMode {
  try {
    const v = localStorage.getItem(BINDER_VIEW_KEY);
    if (v === 'pages' || v === 'list' || v === 'compact') return v;
  } catch {
    /* ignore */
  }
  return 'pages';
}

export function BinderPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const search = useCollectionStore((s) => s.search);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const setSearch = useCollectionStore((s) => s.setSearch);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Sync the URL param into the existing activeTab store field so child
  // components (BinderTabs, BinderView, BinderListView) keep working
  // without each one needing to read useParams.
  useEffect(() => {
    if (routeId) setActiveTab(routeId);
  }, [routeId, setActiveTab]);

  const [cardEditorOpen, setCardEditorOpen] = useState(false);
  const [addCardSheetOpen, setAddCardSheetOpen] = useState(false);
  const [view, setViewRaw] = useState<BinderViewMode>(readStoredBinderView);
  const setView = (v: BinderViewMode) => {
    setViewRaw(v);
    try {
      localStorage.setItem(BINDER_VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const [showImages, setShowImagesRaw] = useState(() => {
    try {
      return localStorage.getItem('mtg-binder-show-images') === 'true';
    } catch {
      /* ignore */
    }
    return false;
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

  const active = materialized.find((b) => b.def.id === routeId) ?? materialized[0];
  const activeId = active?.def.id ?? null;

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
            <button
              type="button"
              className="pill-btn"
              aria-haspopup="dialog"
              onClick={() => setAddCardSheetOpen(true)}
              disabled={!activeId}
            >
              <Plus width={14} height={14} strokeWidth={1.6} aria-hidden />
              <span>Add card</span>
            </button>
            <button
              type="button"
              className="pill-btn"
              aria-haspopup="dialog"
              onClick={() => setCardEditorOpen(true)}
              disabled={!activeId}
            >
              <ListChecks width={14} height={14} strokeWidth={1.6} aria-hidden />
              <span>Edit cards</span>
            </button>
            <button
              type="button"
              className="pill-btn"
              aria-haspopup="dialog"
              onClick={() => activeId && setEditingBinder(activeId)}
              disabled={!activeId}
            >
              <Pencil width={14} height={14} strokeWidth={1.6} aria-hidden />
              <span>Edit binder</span>
            </button>
          </div>
        </header>
      )}
      {active?.def.manualOrder?.length ? (
        <div className="binder-manual-order-bar">
          <span className="sort-mode-badge">Manual order active</span>
          <span className="binder-manual-order-hint">
            Cards are in your custom order. Open "Edit cards" → Order tab to change.
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
              onDelete={async () => {
                const ok = await confirm({
                  title: `Delete "${active.def.name}"?`,
                  body: `Its cards will be re-routed through your other binders. Anything that does not match a remaining binder will only show up in the Collection view.`,
                  confirmLabel: 'Delete binder',
                  danger: true,
                });
                if (ok) deleteBinder(active.def.id);
              }}
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
