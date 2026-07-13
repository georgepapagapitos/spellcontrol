import { BookOpen, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import type {
  BinderSection,
  EnrichedCard,
  MaterializedBinder,
  PocketSize,
  SortEntry,
  SortField,
} from '../types';
import { SortPopover } from './SortPopover';
import { PageGrid } from './PageGrid';
import { CardPreview } from './CardPreview';
import { CardPreviewContext } from './CardPreviewContext';
import { ColorPip } from './shared/ManaSymbol';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';
import { buildEditedCards, isNoOpCardEdit, stackCopies, stackDetailMix } from '../lib/edit-card';
import { BinderPagePreview } from './BinderPagePreview';
import type { SectionTabInput } from '../lib/binder-spreads';
import { BinderDriftBanner } from './BinderDriftBanner';
import { Legend } from './Legend';
import { useAllocations } from '../lib/allocations';
import { useToastsStore } from '../store/toasts';

/** Maximum pages rendered inline per section before the "+N more" expander. */
export const SECTION_PAGE_CAP = 3;

interface Props {
  binders: MaterializedBinder[];
  /**
   * Same binders materialized without the in-binder search filter, used only by
   * the drift banner so a search query doesn't make filtered-out cards look
   * "no longer matching". Defaults to `binders` when no search is active.
   */
  driftBinders?: MaterializedBinder[];
  /** Optional slot rendered in the summary line next to "Collapse all". */
  viewToggle?: React.ReactNode;
  /** Per-copyId qty when binder is in group-printings mode (otherwise undefined). */
  qtyByCopyId?: Map<string, number>;
  /** When true, card slots show thumbnail images instead of text names. */
  showImages?: boolean;
}

export function BinderView({ binders, driftBinders, viewToggle, qtyByCopyId, showImages }: Props) {
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const updateBinder = useCollectionStore((s) => s.updateBinder);

  // The Uncategorized bucket is no longer a tab in this view — it lives in the
  // Collection page filter. Migrate any legacy persisted activeTab to the first
  // real binder so users do not land on a dead tab.
  useEffect(() => {
    const matchesABinder = binders.some((b) => b.def.id === activeTab);
    if (matchesABinder || binders.length === 0) return;
    setActiveTab(binders[0].def.id);
  }, [activeTab, binders, setActiveTab]);

  const active = binders.find((b) => b.def.id === activeTab);

  if (!active) {
    return (
      <div className="empty-state">
        Select a binder above, or click <strong>+ New binder</strong> to create one.
      </div>
    );
  }

  if (active.totalCards === 0) {
    return (
      <div className="empty-state">
        No cards match this binder's rules.{' '}
        <button
          className="btn"
          style={{ marginLeft: 8 }}
          onClick={() => setEditingBinder(active.def.id)}
        >
          Binder rules
        </button>
      </div>
    );
  }

  // Drift reads full membership; fall back to the (filtered) active binder when
  // no search-free set was supplied (e.g. no query active).
  const driftActive = driftBinders?.find((b) => b.def.id === activeTab) ?? active;

  return (
    <>
      <BinderDriftBanner binder={driftActive} />
      <SectionList
        viewKey={active.def.id}
        binderName={active.def.name}
        totalPages={active.totalPages}
        sections={active.sections}
        pocketSize={active.effectivePocketSize}
        doubleSided={active.def.doubleSided}
        editSorts={active.def.sorts}
        valueOrders={active.def.sortValueOrders ?? {}}
        sortEditable={active.def.mode !== 'manual' && !active.def.manualOrder?.length}
        onSortsChange={(next) => updateBinder(active.def.id, { sorts: next })}
        onValueOrdersChange={(next) => updateBinder(active.def.id, { sortValueOrders: next })}
        viewToggle={viewToggle}
        qtyByCopyId={qtyByCopyId}
        showImages={showImages}
      />
    </>
  );
}

function SectionList({
  viewKey,
  binderName,
  totalPages,
  sections,
  pocketSize,
  doubleSided,
  editSorts,
  valueOrders,
  sortEditable,
  onSortsChange,
  onValueOrdersChange,
  viewToggle,
  qtyByCopyId,
  showImages,
}: {
  viewKey: string;
  binderName: string;
  totalPages: number;
  sections: BinderSection[];
  pocketSize: PocketSize;
  doubleSided: boolean;
  editSorts: SortEntry[];
  valueOrders: Partial<Record<SortField, string[]>>;
  sortEditable: boolean;
  onSortsChange: (next: SortEntry[]) => void;
  onValueOrdersChange: (next: Partial<Record<SortField, string[]>>) => void;
  viewToggle?: React.ReactNode;
  qtyByCopyId?: Map<string, number>;
  showImages?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Tap-to-preview state (touch devices). Tracks which section's card list to
  // walk and the active card index. Closes when index goes out of range.
  const [preview, setPreview] = useState<{
    cards: EnrichedCard[];
    index: number;
    sectionLabels: string[];
    pageNumbers: number[];
    totalPages: number;
  } | null>(null);

  // Binder-wide flipbook: all sections' pages flattened into one swipe
  // sequence. The Open button starts at 0; per-page p{N} links start at the
  // global offset of that page.
  const [pagesStartIndex, setPagesStartIndex] = useState<number | null>(null);

  const [editingCard, setEditingCard] = useState<EnrichedCard | null>(null);
  const allocations = useAllocations();
  const allCards = useCollectionStore((s) => s.cards);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const pushToast = useToastsStore((s) => s.push);
  const editingQty = useMemo(() => {
    if (!editingCard) return 0;
    return allCards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.foil === editingCard.foil
    ).length;
  }, [editingCard, allCards]);
  // Only meaningful for a grouped (stacked) edit — an ungrouped (!qtyByCopyId)
  // edit is a single physical copy, trivially uniform. Mirrors the exact
  // scryfallId+finish match buildEditedCards edits by.
  const editingMixedDetails = useMemo(() => {
    if (!editingCard || !qtyByCopyId) return undefined;
    return stackDetailMix(stackCopies(allCards, editingCard));
  }, [editingCard, qtyByCopyId, allCards]);

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingCard) return;
    // Ungrouped: each row is one physical copy — edit just that copy so a stack
    // of identical printings can be split into different printings.
    const copyId = qtyByCopyId ? undefined : editingCard.copyId;
    if (isNoOpCardEdit(editingCard, selection, editingQty, copyId)) {
      setEditingCard(null);
      return;
    }
    const prevCards = allCards;
    const cardName = editingCard.name;
    replaceAllCards(buildEditedCards(editingCard, selection, allCards, copyId));
    pushToast({
      message: `Updated ${cardName}.`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => replaceAllCards(prevCards),
    });
    setEditingCard(null);
  };

  // Reset collapsed state and previews when switching binders so state from
  // one view doesn't carry over into another (different sections, different intent).
  const [prevViewKey, setPrevViewKey] = useState(viewKey);
  if (prevViewKey !== viewKey) {
    setPrevViewKey(viewKey);
    setCollapsed(new Set());
    setPreview(null);
    setPagesStartIndex(null);
  }

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allCollapsed = sections.length > 0 && sections.every((s) => collapsed.has(s.key));
  const collapseAll = () => setCollapsed(new Set(sections.map((s) => s.key)));
  const expandAll = () => setCollapsed(new Set());

  // Binder-wide page list + per-page section labels (parallel arrays).
  const flatPages = useMemo(() => sections.flatMap((s) => s.pages), [sections]);
  const flatPageLabels = useMemo(
    () => sections.flatMap((s) => s.pages.map(() => s.label)),
    [sections]
  );

  // Cumulative page-offset per section, for translating section-local page
  // indices (from p{N} clicks) into the global flat-pages index.
  // Also used to derive `sectionTabs` below — reuse the same running sum.
  const sectionPageOffsets = useMemo(() => {
    return sections.reduce<{ offsets: number[]; total: number }>(
      (acc, s) => {
        acc.offsets.push(acc.total);
        return { offsets: acc.offsets, total: acc.total + s.pages.length };
      },
      { offsets: [], total: 0 }
    ).offsets;
  }, [sections]);

  // Build SectionTabInput[] for the spread-mode index tabs.
  // firstPageIndex = global flat-page offset for the section's first page.
  const sectionTabs = useMemo<SectionTabInput[]>(
    () =>
      sections.map((s, i) => ({
        key: s.key,
        label: s.label,
        pip: s.pip,
        firstPageIndex: sectionPageOffsets[i] ?? 0,
      })),
    [sections, sectionPageOffsets]
  );

  // Flat binder-wide arrays so CardPreview can navigate past section boundaries.
  // Each parallel array is keyed by the global card index.
  const flatCards = useMemo(() => {
    const cards: EnrichedCard[] = [];
    const sectionLabels: string[] = [];
    const pageNumbers: number[] = [];
    const cardIndex = new Map<EnrichedCard, number>();
    for (const section of sections) {
      const sectionPageNumbers = pageNumbersForSection(section);
      section.cards.forEach((card, i) => {
        cardIndex.set(card, cards.length);
        cards.push(card);
        sectionLabels.push(section.label);
        pageNumbers.push(sectionPageNumbers[i] ?? 0);
      });
    }
    return { cards, sectionLabels, pageNumbers, cardIndex };
  }, [sections]);

  const resolveCard = useCallback(
    (card: EnrichedCard) => {
      const i = flatCards.cardIndex.get(card);
      if (i === undefined) return null;
      return {
        cards: flatCards.cards,
        index: i,
        sectionLabels: flatCards.sectionLabels,
        pageNumbers: flatCards.pageNumbers,
        totalPages,
      };
    },
    [flatCards, totalPages]
  );

  // Stable handlers so memoized SectionBlocks don't re-render the whole binder
  // grid on unrelated BinderView state changes — or, critically, on the open
  // itself (see the gridPreviewOpen note below).
  const handleOpenCard = useCallback(
    (card: EnrichedCard) => {
      const next = resolveCard(card);
      if (next) setPreview(next);
    },
    [resolveCard]
  );
  const handleOpenPages = useCallback(
    (sectionIdx: number, localPageIndex: number) =>
      setPagesStartIndex(sectionPageOffsets[sectionIdx] + localPageIndex),
    [sectionPageOffsets]
  );

  // `isPreviewOpen` is consumed by every CardSlot purely to force-hide a stale
  // hover tooltip behind the modal. Threading it synchronously meant opening a
  // preview reconciled the entire binder grid in the same commit that mounts
  // CardPreview — a multi-hundred-ms task that blocked the first paint until
  // the 0.5s sheet-rise had already elapsed, so the sheet "popped in" fully
  // open instead of gliding. Defer that propagation one frame past the open
  // paint: the opaque-ish sheet covers the grid during the rise (which is a
  // compositor-driven transform, unaffected by the later main-thread
  // reconcile), so hiding tooltips a frame late is invisible. Closing clears
  // a frame later so tooltips re-enable just after it (the modal is unmounting,
  // nothing is animating, so the one-frame lag is imperceptible).
  const previewActive = preview !== null || pagesStartIndex !== null;
  const [gridPreviewOpen, setGridPreviewOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGridPreviewOpen(previewActive));
    return () => cancelAnimationFrame(id);
  }, [previewActive]);

  return (
    <>
      <div className="binder-summary" aria-live="polite">
        {flatPages.length > 0 && (
          <button
            type="button"
            className="binder-summary-browse-pages"
            onClick={() => setPagesStartIndex(0)}
            aria-label={`Browse pages of ${binderName}`}
          >
            <BookOpen width={13} height={13} strokeWidth={1.8} aria-hidden />
            <span>Browse pages</span>
          </button>
        )}
        {sortEditable && (
          <span className="binder-summary-sep" aria-hidden="true">
            ·
          </span>
        )}
        {sortEditable && (
          <SortPopover
            sorts={editSorts}
            valueOrders={valueOrders}
            onSortsChange={onSortsChange}
            onValueOrdersChange={onValueOrdersChange}
          />
        )}
        {sections.length > 1 && (
          <button
            type="button"
            className="toolbar-pill binder-summary-collapse"
            onClick={allCollapsed ? expandAll : collapseAll}
          >
            {allCollapsed ? (
              <ChevronsUpDown width={13} height={13} strokeWidth={1.8} aria-hidden />
            ) : (
              <ChevronsDownUp width={13} height={13} strokeWidth={1.8} aria-hidden />
            )}
            <span>{allCollapsed ? 'Expand all' : 'Collapse all'}</span>
          </button>
        )}
        {viewToggle && <div className="binder-summary-viewmode">{viewToggle}</div>}
        <Legend context="binder" variant="pill" align="right" />
      </div>
      {sections.map((section, sectionIdx) => {
        const isCollapsed = collapsed.has(section.key);
        const headerId = `section-header-${viewKey}-${section.key}`;
        const panelId = `section-panel-${viewKey}-${section.key}`;
        return (
          <SectionBlock
            key={section.key}
            section={section}
            sectionIdx={sectionIdx}
            isCollapsed={isCollapsed}
            headerId={headerId}
            panelId={panelId}
            pocketSize={pocketSize}
            isPreviewOpen={gridPreviewOpen}
            qtyByCopyId={qtyByCopyId}
            showImages={showImages}
            onToggle={toggle}
            onOpenCard={handleOpenCard}
            onOpenPages={handleOpenPages}
          />
        );
      })}
      {preview && (
        <CardPreview
          source="binder"
          cards={preview.cards}
          index={preview.index}
          binderName={binderName}
          sectionLabels={preview.sectionLabels}
          pageNumbers={preview.pageNumbers}
          totalPages={preview.totalPages}
          getStackAllocations={(i) => {
            const c = preview.cards[i];
            const a = c ? allocations.get(c.copyId) : null;
            return a ? [a] : [];
          }}
          getStackQty={(i) => {
            const c = preview.cards[i];
            return c ? (qtyByCopyId?.get(c.copyId) ?? 1) : 1;
          }}
          onIndexChange={(i) => setPreview((p) => (p ? { ...p, index: i } : p))}
          onClose={() => setPreview(null)}
          onEdit={(c) => {
            setPreview(null);
            setEditingCard(c);
          }}
        />
      )}
      {pagesStartIndex !== null && (
        <BinderPagePreview
          pages={flatPages}
          pageLabels={flatPageLabels}
          startPageIndex={pagesStartIndex}
          pocketSize={pocketSize}
          doubleSided={doubleSided}
          binderName={binderName}
          resolveCard={resolveCard}
          qtyByCopyId={qtyByCopyId}
          sectionTabs={sectionTabs}
          onClose={() => setPagesStartIndex(null)}
          onEditCard={(c) => {
            setPagesStartIndex(null);
            setEditingCard(c);
          }}
        />
      )}
      {editingCard && (
        <CardEditDialog
          cardName={editingCard.name}
          currentScryfallId={editingCard.scryfallId}
          currentFinish={editingCard.finish ?? (editingCard.foil ? 'foil' : 'nonfoil')}
          quantity={qtyByCopyId ? editingQty : undefined}
          singleCopy={!qtyByCopyId}
          details={{
            condition: editingCard.condition,
            language: editingCard.language,
            altered: editingCard.altered,
            proxy: editingCard.proxy,
            misprint: editingCard.misprint,
          }}
          mixedDetails={editingMixedDetails}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditingCard(null)}
        />
      )}
    </>
  );
}

// Build a parallel array mapping each card in `section.cards` to the page
// number it lives on. Used by both previews to show "p.N" alongside a card.
function pageNumbersForSection(section: BinderSection): number[] {
  const cardToPage = new Map<EnrichedCard, number>();
  section.pages.forEach((page) => {
    page.slots.forEach((slot) => {
      if (slot && !cardToPage.has(slot)) cardToPage.set(slot, page.pageNum);
    });
  });
  return section.cards.map((c) => cardToPage.get(c) ?? 0);
}

const SectionBlock = memo(function SectionBlock({
  section,
  sectionIdx,
  isCollapsed,
  headerId,
  panelId,
  pocketSize,
  isPreviewOpen,
  qtyByCopyId,
  showImages,
  onToggle,
  onOpenCard,
  onOpenPages,
}: {
  section: BinderSection;
  sectionIdx: number;
  isCollapsed: boolean;
  headerId: string;
  panelId: string;
  pocketSize: PocketSize;
  isPreviewOpen: boolean;
  qtyByCopyId?: Map<string, number>;
  showImages?: boolean;
  onToggle: (sectionKey: string) => void;
  onOpenCard: (card: EnrichedCard) => void;
  onOpenPages: (sectionIdx: number, localPageIndex: number) => void;
}) {
  // Whether the user has expanded past the SECTION_PAGE_CAP inline preview.
  const [pagesExpanded, setPagesExpanded] = useState(false);

  // Bind this section's flipbook offset once. Stable identity keeps the
  // context value (and thus every CardSlot) from re-rendering on unrelated
  // BinderView state changes; combined with React.memo above, an open that
  // doesn't touch this section's props skips it entirely.
  const openPages = useCallback(
    (localPageIndex: number) => onOpenPages(sectionIdx, localPageIndex),
    [onOpenPages, sectionIdx]
  );
  const ctxValue = useMemo(
    () => ({ openCard: onOpenCard, openPages, isPreviewOpen, qtyByCopyId }),
    [onOpenCard, openPages, isPreviewOpen, qtyByCopyId]
  );

  const visiblePages = pagesExpanded ? section.pages : section.pages.slice(0, SECTION_PAGE_CAP);
  const hiddenCount = section.pages.length - SECTION_PAGE_CAP;

  return (
    <div className="binder-section">
      <button
        type="button"
        id={headerId}
        className={`section-header section-header-toggle ${isCollapsed ? 'collapsed' : ''}`}
        onClick={() => onToggle(section.key)}
        aria-expanded={!isCollapsed}
        aria-controls={panelId}
      >
        <span className="section-chevron" aria-hidden="true">
          ▾
        </span>
        {section.pip && <ColorPip color={section.key} pip="lg" />}
        <span className="section-title">{section.label}</span>
        <span className="section-meta">
          {section.cards.length} cards · {section.pages.length} page
          {section.pages.length !== 1 ? 's' : ''}
        </span>
      </button>
      {!isCollapsed && (
        <CardPreviewContext.Provider value={ctxValue}>
          <div id={panelId} role="region" aria-labelledby={headerId} className="page-row">
            {visiblePages.map((page, idx) => (
              <PageGrid
                key={page.pageNum}
                page={page.slots}
                pageNum={page.pageNum}
                pageIndex={idx}
                pocketSize={pocketSize}
                showImages={showImages}
              />
            ))}
          </div>
          {!pagesExpanded && hiddenCount > 0 && (
            <button
              type="button"
              className="binder-section-show-more"
              onClick={() => setPagesExpanded(true)}
            >
              +{hiddenCount} more page{hiddenCount !== 1 ? 's' : ''}
            </button>
          )}
        </CardPreviewContext.Provider>
      )}
    </div>
  );
});
