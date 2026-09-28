import {
  AlignJustify,
  LayoutGrid,
  List as ListIconLucide,
  Inbox,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { CollectionHubTabs } from '@/components/CollectionHubTabs';
import { Chip } from '@/components/shared/Chip';
import { useCallback, useMemo, useState } from 'react';
import { usePanelCascade, panelCascadeClass } from '../lib/use-panel-cascade';
import { useStoredSort } from '../lib/use-stored-sort';
import { useStoredView } from '../lib/use-stored-view';
import { Link } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { computeDrift } from '../lib/binder-drift';
import { binderCoverArt } from '../lib/binder-cover';
import { volumesFor, hasMultipleVolumes } from '../lib/binder-volumes';
import { useBinderLayoutInputs } from '../lib/use-binder-layout-inputs';
import { formatMoney } from '../lib/format-money';
import { useConfirm } from '../lib/use-confirm';
import { Modal } from '../components/Modal';
import { SortMenu, type SortMenuOption } from '../components/SortMenu';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SearchPill } from '../components/SearchPill';
import { FilterChipsRow } from '../components/shared/FilterChipsRow';
import { OverflowMenu, type OverflowMenuItem } from '../components/OverflowMenu';
import { PageHeader } from '../components/PageHeader';
import { InfoTip } from '../components/InfoTip';
import { EmptyState } from '../components/shared/EmptyState';
import { Surface } from '../components/shared/Surface';
import {
  SelectToggle,
  BulkSelectBar,
  SelectCheck,
  selectInteraction,
} from '../components/BulkSelectBar';
import { selectedCountLabel, useSelection } from '../lib/use-selection';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { BinderExportDialog } from '../components/BinderExportDialog';
import { UncategorizedSheet } from '../components/UncategorizedSheet';
import { ShareDialog } from '../components/ShareDialog';
import { useBinderActions } from '../components/use-binder-actions';
import { importText } from '../lib/api';
import { sampleCardsAsCsv, SAMPLE_BINDERS, SAMPLE_CARDS } from '../lib/samples';
import { ProgressBar } from '../components/ProgressBar';

import { userMessage } from '@/lib/user-error';
import { useAwaitingFirstPull } from '../lib/use-awaiting-first-pull';
import { Button } from '@/components/shared/Button';
type BinderSortField = 'position' | 'name' | 'cards' | 'pages';
type SortDir = 'asc' | 'desc';
type BindersViewMode = 'grid' | 'list' | 'compact';

// Binders sort on their own keys, so the direction wording is authored here —
// each phrased as what it does to the rows, never asc/desc. "Order" ascending
// is the hand-arranged order, which is also the only state that allows drag.
const SORT_OPTIONS: SortMenuOption<BinderSortField>[] = [
  { value: 'position', label: 'Order', dirLabels: ['Your order', 'Reversed'] },
  { value: 'name', label: 'Name', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'cards', label: 'Card count', dirLabels: ['Fewest', 'Most'] },
  { value: 'pages', label: 'Page count', dirLabels: ['Fewest', 'Most'] },
];

const SORT_DEFAULT_DIR: Record<BinderSortField, SortDir> = {
  position: 'asc',
  name: 'asc',
  cards: 'desc',
  pages: 'desc',
};

export function BindersIndexPage() {
  // BinderPage's inputs, so every count and page total here matches the
  // binder it opens.
  const { cards, binders, allocatedCopyIds, setMap } = useBinderLayoutInputs();
  const awaitingFirstPull = useAwaitingFirstPull();
  const importHistory = useCollectionStore((s) => s.importHistory);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const deleteBinders = useCollectionStore((s) => s.deleteBinders);
  const deleteAllBinders = useCollectionStore((s) => s.deleteAllBinders);
  const sel = useSelection();
  const loadSampleBinders = useCollectionStore((s) => s.loadSampleBinders);
  const setError = useCollectionStore((s) => s.setError);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const hasSampleBinders = useMemo(() => binders.some((b) => b.isSample), [binders]);
  const [showSamplesIntro, setShowSamplesIntro] = useState(false);
  const [loadingSamples, setLoadingSamples] = useState(false);
  // When cards already exist, "Try samples" should only add curated binder
  // rules that filter against the user's collection — skip the starter pack.
  const samplesBindersOnly = cards.length > 0;
  const handleConfirmLoadSamples = async () => {
    setLoadingSamples(true);
    setError(null);
    try {
      const response = samplesBindersOnly ? null : await importText(sampleCardsAsCsv());
      await loadSampleBinders(response);
      setShowSamplesIntro(false);
    } catch (err) {
      setError(userMessage(err, "Couldn't load the samples. Try again in a moment."));
    } finally {
      setLoadingSamples(false);
    }
  };

  // Counts come from the materializer so they match what the binder
  // detail page would render (rules + capacity + dedupe applied).
  const { materialized, uncategorizedCards } = useMemo(() => {
    if (binders.length === 0) return { materialized: [], uncategorizedCards: [] };
    const result = materializeBinders(cards, binders, {
      search: '',
      allocatedCopyIds,
      setMap,
    });
    return {
      materialized: result.binders,
      // The cards no binder takes, from the same pass, so the Uncategorized
      // tile's count can never disagree with the binders' own totals.
      uncategorizedCards: result.uncategorized.sections.flatMap((section) => section.cards),
    };
  }, [cards, binders, allocatedCopyIds, setMap]);

  // Pending filing work per binder ("N to file" chip) — same drift the
  // binder page's banner computes, so the chip and the queue always agree.
  // Never-reviewed binders show nothing: their baseline auto-stamps on first
  // view, so there's no real queue to advertise yet.
  const reviewCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of materialized) {
      const drift = computeDrift(b, cards, importHistory);
      if (!drift.neverReviewed) counts.set(b.def.id, drift.added.length + drift.removed.length);
    }
    return counts;
  }, [materialized, cards, importHistory]);

  // Cover art per binder — an explicit cover card if the user set one, else
  // the most valuable card (see lib/binder-cover.ts). Keyed off `materialized`
  // so search keystrokes don't re-scan every binder's cards.
  const coverArts = useMemo(
    () => new Map(materialized.map((b) => [b.def.id, binderCoverArt(b)])),
    [materialized]
  );

  const { sortField, sortDir, toggleSort } = useStoredSort<BinderSortField>(
    'binders-index-sort',
    SORT_DEFAULT_DIR,
    'position'
  );
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  const [view, setView] = useStoredView<BindersViewMode>(
    'mtg-binders-view-mode',
    ['grid', 'list', 'compact'],
    'grid'
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [uncategorizedOpen, setUncategorizedOpen] = useState(false);
  const [bulkExportOpen, setBulkExportOpen] = useState(false);

  const sorted = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const q = debouncedSearch.trim().toLowerCase();
    const filtered = q
      ? materialized.filter((b) => b.def.name.toLowerCase().includes(q))
      : materialized;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'position':
          cmp = a.def.position - b.def.position;
          break;
        case 'name':
          cmp = a.def.name.localeCompare(b.def.name);
          break;
        case 'cards':
          cmp = a.totalCards - b.totalCards;
          break;
        case 'pages':
          cmp = a.totalPages - b.totalPages;
          break;
      }
      if (cmp === 0) cmp = a.def.position - b.def.position;
      return cmp * dirMul;
    });
  }, [materialized, sortField, sortDir, debouncedSearch]);

  // One-shot entrance cascade for the binder cards — same primitive (and
  // once-per-session consumed registry) as the analysis bento panels. Keyed
  // only when there's something to animate, so an empty first visit doesn't
  // burn the key.
  const cascade = usePanelCascade(sorted.length > 0 ? 'binders-index:cascade' : null);

  // A single delete is undoable from the toast, so it doesn't confirm first
  // (T157) — bulk and delete-all below still do, since the toast there only
  // shows a count.
  const handleDeleteAll = useCallback(async () => {
    const ok = await confirm({
      title: `Delete all ${binders.length} binders?`,
      body: `Every binder definition will be removed. Your cards fall back to the Uncategorized view. You can undo from the toast.`,
      confirmLabel: 'Delete all binders',
      danger: true,
    });
    if (ok) deleteAllBinders();
  }, [confirm, deleteAllBinders, binders.length]);

  const allSelected = sorted.length > 0 && sorted.every((b) => sel.selected.has(b.def.id));
  const selectedDefs = useMemo(
    () => materialized.filter((b) => sel.selected.has(b.def.id)),
    [materialized, sel.selected]
  );

  // One list of a binder's actions for its tile ⋮ and right-click, the same
  // list its own page's ⋮ shows (use-binder-actions.tsx).
  const { actionsFor } = useBinderActions();
  const [shareId, setShareId] = useState<string | null>(null);
  const shareBinder = shareId ? binders.find((b) => b.id === shareId) : undefined;

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(sel.selected);
    const ok = await confirm({
      title: `Delete ${ids.length} selected binder${ids.length === 1 ? '' : 's'}?`,
      body: `Their cards route to your other binders. Anything that no longer matches falls back to the Collection view. You can undo from the toast.`,
      confirmLabel: 'Delete binders',
      danger: true,
    });
    if (ok) {
      deleteBinders(ids);
      sel.exit();
    }
  }, [confirm, deleteBinders, sel]);

  // The selection's actions: the bulk bar's buttons and the menu a right-click
  // inside the selection opens, from one list (T162).
  const bulkActions: OverflowMenuItem[] = [
    { label: 'Export', icon: Upload, onClick: () => setBulkExportOpen(true) },
    {
      label: 'Delete selected',
      icon: Trash2,
      danger: true,
      onClick: () => void handleBulkDelete(),
    },
  ];
  const selectionMenu = (id: string) =>
    sel.selectMode && sel.selected.has(id) && sel.selected.size > 1
      ? { title: selectedCountLabel(sel.selected.size, 'binder'), items: bulkActions }
      : null;

  return (
    <div className="binders-index-page">
      <PageHeader
        title="Binders"
        meta={`${binders.length.toLocaleString()} ${binders.length === 1 ? 'binder' : 'binders'}`}
        menuLabel="More binder actions"
        actions={[
          {
            label: 'New binder',
            icon: Plus,
            primary: true,
            onClick: () => setEditingBinder('new'),
          },
          ...(binders.length > 0
            ? [
                {
                  label: 'Export',
                  icon: Upload,
                  opensDialog: true,
                  onClick: () => setExportOpen(true),
                },
              ]
            : []),
          ...(binders.length > 1
            ? [
                {
                  label: 'Delete all binders',
                  icon: Trash2,
                  danger: true,
                  menuOnly: true,
                  opensDialog: true,
                  onClick: () => void handleDeleteAll(),
                },
              ]
            : []),
        ]}
      />
      <CollectionHubTabs />

      {binders.length > 0 && (
        <div className="binders-index-search-row">
          <SearchPill
            value={search}
            onChange={setSearch}
            placeholder="Search binders"
            ariaLabel="Search binders"
          />
        </div>
      )}

      <FilterChipsRow
        chips={
          search.trim()
            ? [{ id: 'search', label: `"${search.trim()}"`, onClear: () => setSearch('') }]
            : []
        }
        onClearAll={() => setSearch('')}
      />

      {binders.length > 0 && (
        <div className="binders-index-sort-bar">
          {binders.length > 1 && (
            <SortMenu
              value={sortField}
              dir={sortDir}
              options={SORT_OPTIONS}
              onChange={toggleSort}
              ariaLabel="Sort binders by"
            />
          )}
          <ViewModeToggle<BindersViewMode>
            ariaLabel="Binders view mode"
            className="binders-index-viewmode"
            value={view}
            onChange={setView}
            options={[
              {
                value: 'grid',
                label: 'Grid view',
                icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'list',
                label: 'List view',
                icon: <ListIconLucide width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'compact',
                label: 'Compact list (text only)',
                icon: <AlignJustify width={14} height={14} strokeWidth={2} aria-hidden />,
              },
            ]}
          />
          {binders.length > 1 && (
            <SelectToggle
              active={sel.selectMode}
              onToggle={() => (sel.selectMode ? sel.exit() : sel.enter())}
            />
          )}
        </div>
      )}

      {binders.length === 0 && awaitingFirstPull ? (
        /* Same first-pull window #1935 fixed on the binder DETAIL page. That
           fix was page-local, so the index still asserted "No binders yet" for
           1106ms on a cold device that owns four. */
        <div className="page-loader" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="sr-only">Loading your binders…</span>
        </div>
      ) : binders.length === 0 ? (
        cards.length === 0 ? (
          <EmptyState
            mark
            tagline="No binders yet."
            hint="Binders sort your collection by rule. Import it first, or try the samples to see how."
            actions={
              <>
                <Button variant="primary" to="/collection">
                  Import your collection
                </Button>
                <Button onClick={() => setShowSamplesIntro(true)} disabled={loadingSamples}>
                  Try it out
                </Button>
              </>
            }
          />
        ) : (
          <EmptyState
            mark
            tagline="Build your first binder."
            hint="A binder is a rule that catches cards from your collection: one per deck, format, or theme."
            actions={
              <>
                <Button variant="primary" onClick={() => setEditingBinder('new')}>
                  Create your first binder
                </Button>
                {!hasSampleBinders && (
                  <Button onClick={() => setShowSamplesIntro(true)} disabled={loadingSamples}>
                    Load sample binders
                  </Button>
                )}
              </>
            }
          />
        )
      ) : sorted.length === 0 ? (
        <EmptyState tagline={`No binders match "${debouncedSearch}".`} />
      ) : (
        <>
          {sel.selectMode && (
            <BulkSelectBar
              count={sel.selected.size}
              total={sorted.length}
              allSelected={allSelected}
              onToggleAll={() =>
                allSelected ? sel.clear() : sel.selectAll(sorted.map((b) => b.def.id))
              }
              onClear={sel.clear}
              onDone={sel.exit}
              noun="binder"
              actions={bulkActions}
            />
          )}
          {sortField === 'position' && sortDir === 'asc' && (
            // Phones get the short form: the full sentence is permanent
            // chrome there — two muted lines above the binders on every
            // visit — and the tip it hangs off carries the whole rule
            // anyway. Long/short span pair per STYLE_GUIDE's shrink-the-label
            // ruling; the page's own gap owns the space below it.
            <p className="muted binders-index-hint">
              <span className="binders-index-hint-long">
                Cards file into the first binder whose rules match, top to{' '}
              </span>
              <span className="binders-index-hint-tail">
                <span className="binders-index-hint-long">bottom. </span>
                <span className="binders-index-hint-short">Priority order </span>
                <InfoTip
                  label="binder priority order"
                  text={
                    <>
                      <p className="info-tip-lead">
                        This order is a <strong>priority list</strong>, not just a display order.
                      </p>
                      <ul className="info-tip-list">
                        <li>
                          A card lands in exactly one binder: the first one, top to bottom, whose
                          rules match it.
                        </li>
                        <li>
                          A binder further down only ever sees the cards every binder above it
                          passed on.
                        </li>
                        <li>
                          Reorder from a row's ⋮ menu (Move up / Move down). You'll get a toast
                          showing how many cards moved.
                        </li>
                      </ul>
                    </>
                  }
                />
              </span>
            </p>
          )}
          <ul className={`binders-index-list is-${view}`}>
            {sorted.map((b, idx) => {
              const selected = sel.selected.has(b.def.id);
              const art = coverArts.get(b.def.id);
              // `materialized`/`sorted` come from an unfiltered pass (search: ''
              // above), exactly what `volumesFor` requires.
              const volumes = volumesFor(b);
              return (
                <Surface
                  as="li"
                  variant="sleeve"
                  key={b.def.id}
                  className={`binders-index-card${sel.selectMode ? ' bulk-selectable' : ''}${
                    selected ? ' bulk-selected' : ''
                  }${
                    panelCascadeClass(idx, cascade.animating)
                      ? ` ${panelCascadeClass(idx, cascade.animating)}`
                      : ''
                  }`}
                  style={{ ['--binder-color' as string]: b.def.color }}
                  {...selectInteraction(sel.selectMode, selected, () => sel.toggle(b.def.id))}
                >
                  {sel.selectMode && <SelectCheck checked={selected} />}
                  <Link to={`/collection/binders/${b.def.id}`} className="binders-index-card-link">
                    {view !== 'compact' && art && (
                      /* Cover art — user-chosen card, else the binder's most
                         valuable card. Mirrors the decks-index commander art. */
                      <img className="binders-index-card-art" src={art} alt="" aria-hidden="true" />
                    )}
                    {view === 'grid' && !art && (
                      /* Coverless grid tiles (empty binder / no imaged cards)
                         get a solid band of the binder color — a plain binder
                         cover — so tiles in a row stay uniform. */
                      <span className="binders-index-card-banner" aria-hidden />
                    )}
                    <div className="binders-index-card-body">
                      <div className="binders-index-card-name">{b.def.name}</div>
                      <div className="binders-index-card-meta">
                        {/* Tags on one line, the card/page/value stats on the next when the
                            row is tight, so a wrap never lands mid-stat with a stray "·". */}
                        <span className="binders-index-card-tags">
                          {sortField === 'position' && sortDir === 'asc' && (
                            <Chip
                              className="binders-index-card-tag"
                              aria-label={`Priority ${b.def.position + 1}`}
                            >
                              #{b.def.position + 1}
                            </Chip>
                          )}
                          {b.def.mode === 'manual' && (
                            <Chip className="binders-index-card-tag">Manual</Chip>
                          )}
                          {(reviewCounts.get(b.def.id) ?? 0) > 0 && (
                            <Chip
                              className="binders-index-card-tag"
                              tone="info"
                              aria-label={`${reviewCounts.get(b.def.id)} ${
                                reviewCounts.get(b.def.id) === 1 ? 'change' : 'changes'
                              } to file`}
                            >
                              {reviewCounts.get(b.def.id)} to file
                            </Chip>
                          )}
                          {b.def.fixedCapacity != null && (
                            <Chip className="binders-index-card-tag">
                              Cap {b.def.fixedCapacity.toLocaleString()}
                            </Chip>
                          )}
                          {hasMultipleVolumes(volumes) && (
                            <Chip
                              className="binders-index-card-tag"
                              aria-label={`Fills ${volumes.length} physical binders`}
                            >
                              {volumes.length} volumes
                            </Chip>
                          )}
                        </span>
                        <span className="binders-index-card-stats">
                          {/* Split into two spans so compact mode (which hides the
                        cards count via CSS) can still show the page count
                        as a quick skim signal. */}
                          <span className="binders-index-card-cards">
                            {b.totalCards.toLocaleString()} {b.totalCards === 1 ? 'card' : 'cards'}
                          </span>
                          <span className="binders-index-card-pages">
                            {b.totalPages.toLocaleString()} {b.totalPages === 1 ? 'page' : 'pages'}
                          </span>
                          {b.totalValue > 0 && (
                            <span className="binders-index-card-value">
                              {formatMoney(b.totalValue, { wholeDollars: true })}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </Link>
                  <OverflowMenu
                    className="binders-index-card-menu"
                    triggerClassName="binders-index-card-menu-btn"
                    ariaLabel={`Actions for ${b.def.name}`}
                    contextHost=".binders-index-card"
                    itemHref={`/collection/binders/${b.def.id}`}
                    itemName={b.def.name}
                    selection={selectionMenu(b.def.id)}
                    items={actionsFor(b.def, {
                      onShare: () => setShareId(b.def.id),
                      // Moving a binder only shows in the list's priority order.
                      canReorder: sortField === 'position' && sortDir === 'asc',
                    })}
                  />
                </Surface>
              );
            })}
            {/* The cards no binder takes, as the last thing in the list: it is
                below every binder in priority, and never above the binders it
                follows. Hidden while searching or selecting (it is not a
                binder), and absent when every card has a home. */}
            {uncategorizedCards.length > 0 && !debouncedSearch.trim() && !sel.selectMode && (
              <Surface
                as="li"
                variant="sleeve"
                className="binders-index-card binders-index-card--uncategorized"
              >
                <button
                  type="button"
                  className="binders-index-card-link"
                  onClick={() => setUncategorizedOpen(true)}
                  aria-haspopup="dialog"
                >
                  {view === 'grid' && (
                    <span className="binders-index-card-banner" aria-hidden>
                      <Inbox width={28} height={28} strokeWidth={1.5} />
                    </span>
                  )}
                  <div className="binders-index-card-body">
                    <div className="binders-index-card-name">Uncategorized</div>
                    <div className="binders-index-card-meta">
                      <span className="binders-index-card-stats">
                        <span className="binders-index-card-unfiled">
                          {uncategorizedCards.length.toLocaleString()}{' '}
                          {uncategorizedCards.length === 1 ? 'card' : 'cards'} in no binder
                        </span>
                      </span>
                    </div>
                  </div>
                </button>
              </Surface>
            )}
          </ul>
        </>
      )}

      {shareBinder && (
        <ShareDialog
          kind="binder"
          resourceId={shareBinder.id}
          resourceLabel={shareBinder.name}
          onClose={() => setShareId(null)}
        />
      )}

      {uncategorizedOpen && (
        <UncategorizedSheet
          cards={uncategorizedCards}
          onClose={() => setUncategorizedOpen(false)}
        />
      )}

      {exportOpen && (
        <BinderExportDialog
          binders={materialized}
          activeId={null}
          onClose={() => setExportOpen(false)}
        />
      )}

      {bulkExportOpen && selectedDefs.length > 0 && (
        <BinderExportDialog
          binders={selectedDefs}
          activeId={null}
          onClose={() => setBulkExportOpen(false)}
        />
      )}

      {showSamplesIntro && (
        <SamplesIntroDialog
          loading={loadingSamples}
          bindersOnly={samplesBindersOnly}
          onConfirm={() => void handleConfirmLoadSamples()}
          onCancel={() => setShowSamplesIntro(false)}
        />
      )}

      {confirmDialog}
    </div>
  );
}

interface SamplesIntroDialogProps {
  loading: boolean;
  bindersOnly: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function SamplesIntroDialog({
  loading,
  bindersOnly,
  onConfirm,
  onCancel,
}: SamplesIntroDialogProps) {
  return (
    <Modal
      onClose={onCancel}
      dismissable={!loading}
      className="choice-dialog"
      labelledBy="samples-intro-title"
    >
      <h2 id="samples-intro-title" className="choice-dialog-title">
        {bindersOnly ? 'Load sample binders?' : 'Load samples?'}
      </h2>
      <p className="choice-dialog-body">
        {bindersOnly
          ? `This creates ${SAMPLE_BINDERS.length} sample binders that show off the rule system. They filter your existing collection. No extra cards are added.`
          : `This will create ${SAMPLE_BINDERS.length} sample binders that show off the rule system, plus a starter pack of ${SAMPLE_CARDS.length} cards so each binder has visible matches.`}
      </p>
      <ul className="samples-intro-list">
        {SAMPLE_BINDERS.map((s) => (
          <li key={s.templateId}>
            <strong>{s.input.name}</strong>
          </li>
        ))}
      </ul>
      <p className="choice-dialog-body">
        <strong>Removing samples later:</strong>
      </p>
      <ul className="samples-intro-list">
        <li>Each sample binder has Delete in its card menu. That removes just that binder.</li>
        {!bindersOnly && (
          <li>
            The bundled cards land in{' '}
            <Link to="/collection" className="link-warn">
              Collection → Import history
            </Link>{' '}
            as "Sample: starter pack". Tick its checkbox and Delete selected to remove them.
          </li>
        )}
      </ul>
      {loading && (
        <ProgressBar
          indeterminate
          message={bindersOnly ? 'Building sample binders…' : 'Importing starter pack…'}
        />
      )}
      <div className="choice-dialog-actions">
        <Button onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={loading} autoFocus>
          {loading ? 'Loading…' : bindersOnly ? 'Load sample binders' : 'Load samples'}
        </Button>
      </div>
    </Modal>
  );
}
