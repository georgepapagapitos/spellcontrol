import { ListChecks, Plus } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { getSyncState, hasSyncError, onSyncedChange } from '@/lib/sync';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import { AddCardSheet } from '@/components/binder/AddCardSheet';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { BackLink } from '@/components/app-shell/BackLink';
import { EmptyState } from '../components/shared/EmptyState';
import { Chip } from '../components/shared/Chip';

const BinderCardEditor = lazy(() =>
  import('@/components/binder/BinderCardEditor').then((m) => ({ default: m.BinderCardEditor }))
);
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '@/lib/binder/materialize';
import { findRedundantPins } from '@/lib/binder/binder-pin-dissolve';
import { useBinderLayoutInputs } from '@/lib/binder/use-binder-layout-inputs';
import { buildQtyByPrintingKey } from '@/lib/search/sorting';
import { useDebouncedValue } from '@/lib/util/use-debounced-value';
import { BinderTabs } from '@/components/binder/BinderTabs';
import { BinderDriftBanner } from '@/components/binder/BinderDriftBanner';
import { BinderView } from '@/components/binder/BinderView';
import { BinderListView } from '@/components/binder/BinderListView';
import { BinderVolumesSheet } from '@/components/binder/BinderVolumesSheet';
import { volumesFor, hasMultipleVolumes } from '@/lib/binder/binder-volumes';
import { SearchPill } from '@/components/search/SearchPill';
import { FilterChipsRow } from '../components/shared/FilterChipsRow';
import { type BinderViewControls, type BinderViewMode } from '@/components/binder/BinderSummaryBar';
import { useStoredView } from '@/lib/util/use-stored-view';
import { ShareDialog } from '@/components/share/ShareDialog';
import { useBinderActions } from '@/components/binder/use-binder-actions';
import { CardName } from '@/components/shared/CardName';
import { Button } from '@/components/shared/Button';
import { areAllGroupsEmpty } from '@/lib/binder/rules';
import { countEffectiveLanding } from '@/lib/binder/binder-counts';
import { toast } from '../store/toasts';
import type { BinderDef } from '../types';

export function BinderPage() {
  const { id: routeId } = useParams<{ id: string }>();
  // Decorated cards (tags/Secret Lair drops/release dates) + binders +
  // allocatedCopyIds + setMap — the exact chain this page materializes from,
  // shared with the Add-list row prediction and the post-import routing
  // summary so neither can drift from what this page actually renders.
  const { cards, binders, allocatedCopyIds, setMap } = useBinderLayoutInputs();
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
  // the pre-existing behavior.
  const awaitingFirstPull = isAuthed && getSyncState() !== 'ready' && !hasSyncError();
  const search = useCollectionStore((s) => s.search);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const setSearch = useCollectionStore((s) => s.setSearch);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
  const updateBinder = useCollectionStore((s) => s.updateBinder);

  // Sync the URL param into the existing activeTab store field so child
  // components (BinderTabs, BinderView, BinderListView) keep working
  // without each one needing to read useParams.
  useEffect(() => {
    if (routeId) setActiveTab(routeId);
  }, [routeId, setActiveTab]);

  const [cardEditorOpen, setCardEditorOpen] = useState(false);
  const [addCardSheetOpen, setAddCardSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [volumesSheetOpen, setVolumesSheetOpen] = useState(false);
  const { actionsFor } = useBinderActions();
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

  // Volumes: read off an UNFILTERED materialize pass (driftBinders is already
  // that pass, reused here rather than a third materialize call) — a
  // search-narrowed pass would under-count pages and misreport how many
  // physical books this binder needs. `null` = no fixed capacity.
  const activeUnfiltered = driftBinders.find((b) => b.def.id === active?.def.id) ?? active;
  const activeVolumes = useMemo(
    () => (activeUnfiltered ? volumesFor(activeUnfiltered) : null),
    [activeUnfiltered]
  );

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

  // A manual binder with rules kept but paused: how many cards those rules
  // would bring in, from the editor's own landing count (so the number the
  // bar promises is the one "Switch to rules" delivers). Null when the rules
  // are on, or there are none to go back to.
  const setBinderMode = useCollectionStore((s) => s.setBinderMode);
  const pausedRulesLand = useMemo(() => {
    if (!active || active.def.mode !== 'manual' || areAllGroupsEmpty(active.def.filterGroups))
      return null;
    return countEffectiveLanding(
      cards,
      binders,
      {
        id: active.def.id,
        groups: active.def.filterGroups,
        keepPrintingsTogether: !!active.def.keepPrintingsTogether,
        mode: 'rules',
      },
      { allocatedCopyIds, setMap }
    ).lands;
  }, [active, cards, binders, allocatedCopyIds, setMap]);
  const resumeRules = (def: BinderDef) => {
    setBinderMode(def.id, 'rules');
    toast.show({
      message: `${def.name} files by its rules again`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => setBinderMode(def.id, 'manual'),
    });
  };
  // "Use a <size>-card binder" in the volumes sheet: a normal capacity edit
  // through the store's own update path, exactly what saving the editor
  // would do — never a hand-rolled sync write. Same undo-toast shape as
  // resumeRules above.
  const applyFitCapacity = (def: BinderDef, size: number) => {
    const previous = def.fixedCapacity;
    updateBinder(def.id, { fixedCapacity: size });
    toast.show({
      message: `${def.name} now holds ${size.toLocaleString()} cards`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => updateBinder(def.id, { fixedCapacity: previous }),
    });
  };

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

  // One control row for all three views (BinderSummaryBar). The two display
  // toggles only mean something on the page grid, so the lists get none.
  const controls: BinderViewControls = {
    view,
    onViewChange: setView,
    toggles:
      view === 'pages'
        ? [
            {
              key: 'show-images',
              label: 'Show card images',
              value: showImages,
              onChange: setShowImages,
              // On by default: only badge it once the user turns images off.
              defaultValue: true,
            },
            {
              key: 'group-printings',
              label: 'Group printings',
              value: groupPrintings,
              onChange: setGroupPrintings,
            },
          ]
        : [],
  };

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
            // The binder's own actions, the same list its index tile's ⋮
            // shows (use-binder-actions.tsx). Binder rules and Share may
            // stand as buttons where there is room; reordering and Delete
            // stay in the ⋮.
            ...actionsFor(active.def, { onShare: () => setShareOpen(true) }).map(
              ({ canStandAlone, ...a }) => ({ ...a, menuOnly: !canStandAlone })
            ),
          ]}
          meta={
            active.def.fixedCapacity != null ? (
              <>
                {active.totalCards.toLocaleString()} / {active.def.fixedCapacity.toLocaleString()}{' '}
                cards · {active.totalPages.toLocaleString()} /{' '}
                {Math.ceil(active.def.fixedCapacity / active.effectivePocketSize).toLocaleString()}{' '}
                pages
                {hasMultipleVolumes(activeVolumes) && (
                  <>
                    {' · '}
                    <Button
                      variant="link"
                      title={`Over capacity by ${(active.totalCards - active.def.fixedCapacity).toLocaleString()} cards`}
                      onClick={() => setVolumesSheetOpen(true)}
                    >
                      {activeVolumes.length} volumes
                    </Button>
                  </>
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
      {volumesSheetOpen &&
        active &&
        active.def.fixedCapacity != null &&
        hasMultipleVolumes(activeVolumes) && (
          <BinderVolumesSheet
            binderName={active.def.name}
            volumes={activeVolumes}
            fixedCapacity={active.def.fixedCapacity}
            pocketSize={active.effectivePocketSize}
            totalPages={activeUnfiltered?.totalPages ?? active.totalPages}
            onApplyFit={(size) => {
              applyFitCapacity(active.def, size);
              setVolumesSheetOpen(false);
            }}
            onOpenRules={() => {
              setVolumesSheetOpen(false);
              setEditingBinder(active.def.id);
            }}
            onClose={() => setVolumesSheetOpen(false)}
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
      {active && pausedRulesLand !== null && (
        // A manual binder shows only the cards added to it by hand; its rules
        // are kept but paused. Binders got here silently once (a move into a
        // binder the card didn't fit flipped it, fixed in #2421), and the
        // only way back was inside the editor.
        <div className="binder-manual-order-bar" role="status">
          <Chip className="sort-mode-badge" tone="accent">
            Rules paused
          </Chip>
          <span className="binder-manual-order-hint">
            Only the cards you added show here.{' '}
            {pausedRulesLand > 0
              ? `Its rules would file ${pausedRulesLand.toLocaleString()} ${pausedRulesLand === 1 ? 'card' : 'cards'} here.`
              : 'Its rules match no cards right now.'}
          </span>
          <Button variant="link" onClick={() => resumeRules(active.def)}>
            Switch to rules
          </Button>
        </div>
      )}
      {active?.def.manualOrder?.length ? (
        <div className="binder-manual-order-bar">
          <Chip className="sort-mode-badge" tone="accent">
            Custom order
          </Chip>
          <span className="binder-manual-order-hint">Change it in Manage cards.</span>
        </div>
      ) : null}
      <div className="binder-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search"
          ariaLabel="Search cards by name"
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
          volumes={activeVolumes}
          controls={controls}
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
              <EmptyState
                tagline="No cards match this binder's rules."
                hint="Loosen a rule to catch more cards."
                actions={
                  <Button variant="primary" onClick={() => setEditingBinder(active.def.id)}>
                    Binder rules
                  </Button>
                }
              />
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
                controls={controls}
                qtyByCopyId={qtyByCopyId}
                density={view === 'compact' ? 'compact' : 'detail'}
                volumes={activeVolumes}
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
                    <span className="print-list-name">
                      <CardName card={row} />
                    </span>
                    <span className="print-list-printing">
                      {row.setCode.toUpperCase()} {row.collectorNumber}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </>
  );
}
