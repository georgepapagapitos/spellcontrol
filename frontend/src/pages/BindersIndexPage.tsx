import {
  AlignJustify,
  ArrowDown,
  ArrowUp,
  LayoutGrid,
  List as ListIconLucide,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useStoredSort } from '../lib/use-stored-sort';
import { useStoredView } from '../lib/use-stored-view';
import { Link } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { toast } from '../store/toasts';
import { useAllocations } from '../lib/allocations';
import { materializeBinders } from '../lib/materialize';
import { diffMembershipByDefs } from '../lib/binder-moves';
import { useCardsWithTags, bindersUseTags } from '../lib/card-tags';
import { formatMoney } from '../lib/format-money';
import { useSetMap } from '../lib/api';
import { useConfirm } from '../lib/use-confirm';
import { Modal } from '../components/Modal';
import { SelectMenu, type SelectOption } from '../components/SelectMenu';
import { SortDirArrow } from '../components/SortDirArrow';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SearchPill } from '../components/SearchPill';
import { OverflowMenu } from '../components/OverflowMenu';
import { InfoTip } from '../components/InfoTip';
import {
  SelectToggle,
  BulkSelectBar,
  SelectCheck,
  selectInteraction,
} from '../components/BulkSelectBar';
import { useSelection } from '../lib/use-selection';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { BinderExportDialog } from '../components/BinderExportDialog';
import { importText } from '../lib/api';
import { sampleCardsAsCsv, SAMPLE_BINDERS, SAMPLE_CARDS } from '../lib/samples';
import { ProgressBar } from '../components/ProgressBar';

type BinderSortField = 'position' | 'name' | 'cards' | 'pages';
type SortDir = 'asc' | 'desc';
type BindersViewMode = 'grid' | 'list' | 'compact';

const SORT_OPTIONS: SelectOption<BinderSortField>[] = [
  { value: 'position', label: 'Order' },
  { value: 'name', label: 'Name' },
  { value: 'cards', label: 'Card count' },
  { value: 'pages', label: 'Page count' },
];

const SORT_DEFAULT_DIR: Record<BinderSortField, SortDir> = {
  position: 'asc',
  name: 'asc',
  cards: 'desc',
  pages: 'desc',
};

export function BindersIndexPage() {
  const rawCards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  // Decorate with Scryfall oracle tags (no-op unless a binder uses a tag rule).
  const cards = useCardsWithTags(rawCards, bindersUseTags(binders));
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);
  const deleteBinders = useCollectionStore((s) => s.deleteBinders);
  const deleteAllBinders = useCollectionStore((s) => s.deleteAllBinders);
  const sel = useSelection();
  const moveBinder = useCollectionStore((s) => s.moveBinder);
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
      setError(err instanceof Error ? err.message : "Couldn't load samples");
    } finally {
      setLoadingSamples(false);
    }
  };

  const allocations = useAllocations();
  const allocatedCopyIds = useMemo(() => new Set(allocations.keys()), [allocations]);
  const setMap = useSetMap();

  // Counts come from the materializer so they match what the binder
  // detail page would render (rules + capacity + dedupe applied).
  const materialized = useMemo(() => {
    if (binders.length === 0) return [];
    return materializeBinders(cards, binders, {
      search: '',
      allocatedCopyIds,
      setMap,
    }).binders;
  }, [cards, binders, allocatedCopyIds, setMap]);

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

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      const ok = await confirm({
        title: `Delete "${name}"?`,
        body: `Its cards will be re-routed through your other binders. Anything that does not match a remaining binder will only show up in the Collection view.`,
        confirmLabel: 'Delete binder',
        danger: true,
      });
      if (ok) deleteBinder(id);
    },
    [confirm, deleteBinder]
  );

  const handleDeleteAll = useCallback(async () => {
    const ok = await confirm({
      title: `Delete all ${binders.length} binders?`,
      body: `Every binder definition will be removed. Your cards stay where they are — they'll fall back to the Uncategorized view until you build new binders. This cannot be undone.`,
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

  // Reordering re-routes the whole waterfall below the moved binder, so a
  // single up/down click can silently shuffle cards between binders. Diff
  // membership before/after (same collection, old vs new binder-def order)
  // and toast the impact so that isn't invisible.
  const handleMove = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const oldDefs = binders;
      moveBinder(id, direction);
      const newDefs = useCollectionStore.getState().binders;
      const changed = diffMembershipByDefs(cards, oldDefs, newDefs, { allocatedCopyIds });
      toast.show({
        message:
          changed > 0
            ? `Reorder moved ${changed.toLocaleString()} card${changed === 1 ? '' : 's'} between binders`
            : "Reorder didn't move any cards",
        tone: 'info',
      });
    },
    [binders, moveBinder, cards, allocatedCopyIds]
  );

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(sel.selected);
    const ok = await confirm({
      title: `Delete ${ids.length} selected binder${ids.length === 1 ? '' : 's'}?`,
      body: `Their cards will be re-routed through your other binders. Anything that does not match a remaining binder will only show up in the Collection view.`,
      confirmLabel: 'Delete binders',
      danger: true,
    });
    if (ok) {
      deleteBinders(ids);
      sel.exit();
    }
  }, [confirm, deleteBinders, sel]);

  return (
    <div className="binders-index-page">
      <header className="binder-hero binders-index-hero">
        <div className="binders-index-hero-text">
          <h1 className="binder-hero-name">Binders</h1>
          <p className="binder-hero-meta">
            {binders.length.toLocaleString()} {binders.length === 1 ? 'binder' : 'binders'}
          </p>
        </div>
        <div className="binders-index-actions">
          {binders.length > 0 && (
            <button
              type="button"
              className="pill-btn"
              aria-haspopup="dialog"
              onClick={() => setExportOpen(true)}
            >
              <Upload width={14} height={14} strokeWidth={1.8} aria-hidden />
              <span>Export</span>
            </button>
          )}
          <button
            type="button"
            className="pill-btn pill-btn-primary"
            onClick={() => setEditingBinder('new')}
          >
            <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>New binder</span>
          </button>
        </div>
      </header>

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

      {binders.length > 0 && (
        <div className="binders-index-sort-bar">
          {binders.length > 1 && (
            <SelectMenu
              value={sortField}
              options={SORT_OPTIONS}
              onChange={toggleSort}
              ariaLabel="Sort binders by"
              closeOnSelect={false}
              leadingIcon={<SortDirArrow dir={sortDir} />}
              renderItemPrefix={(_opt, active) => (active ? <SortDirArrow dir={sortDir} /> : null)}
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

      {binders.length === 0 ? (
        cards.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-tagline">No binders yet.</p>
            <p className="empty-state-hint">
              Import your collection first, then build rule-based binders to organize it. Or try the
              samples to see how binder rules work.
            </p>
            <div className="empty-state-actions">
              <Link to="/collection" className="btn btn-primary">
                Import your collection
              </Link>
              <button
                type="button"
                className="btn"
                onClick={() => setShowSamplesIntro(true)}
                disabled={loadingSamples}
              >
                Try it out
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-state-tagline">Build your first binder.</p>
            <p className="empty-state-hint">
              A binder is a set of rules that catches cards from your collection. Make one for each
              deck, format, or theme you want to plan around.
            </p>
            <div className="empty-state-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setEditingBinder('new')}
              >
                Create your first binder
              </button>
              {!hasSampleBinders && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowSamplesIntro(true)}
                  disabled={loadingSamples}
                >
                  Load sample binders
                </button>
              )}
            </div>
          </div>
        )
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">No binders match "{debouncedSearch}".</p>
        </div>
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
            >
              <button
                type="button"
                className="pill-btn"
                disabled={sel.selected.size === 0}
                onClick={() => setBulkExportOpen(true)}
              >
                <Upload width={14} height={14} strokeWidth={1.8} aria-hidden />
                <span>Export</span>
              </button>
              <button
                type="button"
                className="pill-btn bulk-bar-danger"
                disabled={sel.selected.size === 0}
                onClick={() => void handleBulkDelete()}
              >
                <Trash2 width={14} height={14} strokeWidth={1.8} aria-hidden />
                <span>Delete selected</span>
              </button>
            </BulkSelectBar>
          )}
          {sortField === 'position' && sortDir === 'asc' && (
            <p className="muted" style={{ marginBottom: '0.5rem' }}>
              Cards file into the first binder whose rules match, top to bottom.{' '}
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
                        A binder further down only ever sees the cards every binder above it passed
                        on.
                      </li>
                      <li>
                        Reorder from a row's ⋮ menu (Move up / Move down) — you'll get a toast
                        showing how many cards moved.
                      </li>
                    </ul>
                  </>
                }
              />
            </p>
          )}
          <ul className={`binders-index-list is-${view}`}>
            {sorted.map((b, idx) => {
              const selected = sel.selected.has(b.def.id);
              return (
                <li
                  key={b.def.id}
                  className={`binders-index-card${sel.selectMode ? ' bulk-selectable' : ''}${
                    selected ? ' bulk-selected' : ''
                  }`}
                  style={{ ['--binder-color' as string]: b.def.color }}
                  {...selectInteraction(sel.selectMode, selected, () => sel.toggle(b.def.id))}
                >
                  {sel.selectMode && <SelectCheck checked={selected} />}
                  <Link to={`/collection/binders/${b.def.id}`} className="binders-index-card-link">
                    <div className="binders-index-card-body">
                      <div className="binders-index-card-name">{b.def.name}</div>
                      <div className="binders-index-card-meta">
                        {sortField === 'position' && sortDir === 'asc' && (
                          <span
                            className="binders-index-card-tag"
                            aria-label={`Priority ${b.def.position + 1}`}
                          >
                            #{b.def.position + 1}
                          </span>
                        )}
                        {b.def.mode === 'manual' && (
                          <span className="binders-index-card-tag">Manual</span>
                        )}
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
                        {b.def.fixedCapacity != null && (
                          <span className="binders-index-card-tag">
                            Cap {b.def.fixedCapacity.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                  <OverflowMenu
                    className="binders-index-card-menu"
                    triggerClassName="binders-index-card-menu-btn"
                    ariaLabel={`Actions for ${b.def.name}`}
                    items={[
                      // Suppress reorder unless sorted by position asc — moving
                      // wouldn't visibly change a name/count-sorted list.
                      ...(sortField === 'position' && sortDir === 'asc'
                        ? [
                            {
                              label: 'Move up',
                              icon: ArrowUp,
                              disabled: idx === 0,
                              onClick: () => handleMove(b.def.id, 'up'),
                            },
                            {
                              label: 'Move down',
                              icon: ArrowDown,
                              disabled: idx === sorted.length - 1,
                              onClick: () => handleMove(b.def.id, 'down'),
                            },
                          ]
                        : []),
                      {
                        label: 'Edit binder',
                        icon: Pencil,
                        onClick: () => setEditingBinder(b.def.id),
                      },
                      {
                        label: 'Delete binder',
                        icon: Trash2,
                        danger: true,
                        onClick: () => void handleDelete(b.def.id, b.def.name),
                      },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {binders.length > 1 && (
        <div className="binders-index-danger">
          <button
            type="button"
            className="btn-link binders-index-danger-btn"
            onClick={() => void handleDeleteAll()}
          >
            Delete all binders
          </button>
        </div>
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
          ? `This will create ${SAMPLE_BINDERS.length} sample binders that show off the rule system. They will filter against your existing collection — no extra cards are added.`
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
        <li>Each sample binder has Delete in its card menu — that removes just that binder.</li>
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
        <button type="button" className="btn" onClick={onCancel} disabled={loading}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirm}
          disabled={loading}
          autoFocus
        >
          {loading ? 'Loading…' : bindersOnly ? 'Load sample binders' : 'Load samples'}
        </button>
      </div>
    </Modal>
  );
}
