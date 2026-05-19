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
import type { ScryfallCard } from '@/deck-builder/types';
import { SortPopover } from './SortPopover';
import { PageGrid } from './PageGrid';
import { CardPreview } from './CardPreview';
import { CardPreviewContext } from './CardPreviewContext';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';
import { BinderPagePreview } from './BinderPagePreview';
import { Legend } from './Legend';
import { useConfirm } from '../lib/use-confirm';
import { useAllocations } from '../lib/allocations';

function pickPrice(card: ScryfallCard, foil: boolean): number {
  const p = card.prices;
  if (!p) return 0;
  const candidates = foil ? [p.usd_foil, p.usd_etched, p.usd] : [p.usd, p.usd_etched, p.usd_foil];
  for (const raw of candidates) {
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

interface Props {
  binders: MaterializedBinder[];
  /** Optional slot rendered in the summary line next to "Collapse all". */
  viewToggle?: React.ReactNode;
  /** Per-copyId qty when binder is in group-printings mode (otherwise undefined). */
  qtyByCopyId?: Map<string, number>;
  /** When true, card slots show thumbnail images instead of text names. */
  showImages?: boolean;
}

export function BinderView({ binders, viewToggle, qtyByCopyId, showImages }: Props) {
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);
  const updateBinder = useCollectionStore((s) => s.updateBinder);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // The Uncategorized bucket is no longer a tab in this view — it lives in the
  // Collection page filter. Migrate any legacy persisted activeTab to the first
  // real binder so users do not land on a dead tab.
  useEffect(() => {
    const matchesABinder = binders.some((b) => b.def.id === activeTab);
    if (matchesABinder || binders.length === 0) return;
    setActiveTab(binders[0].def.id);
  }, [activeTab, binders, setActiveTab]);

  const active = binders.find((b) => b.def.id === activeTab);

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      body: `Its cards will be re-routed through your other binders. Anything that does not match a remaining binder will only show up in the Collection view.`,
      confirmLabel: 'Delete binder',
      danger: true,
    });
    if (ok) deleteBinder(id);
  };

  if (!active) {
    return (
      <div className="empty-state">
        Select a binder above, or click <strong>+ New binder</strong> to create one.
      </div>
    );
  }

  if (active.totalCards === 0) {
    return (
      <>
        <div className="empty-state">
          No cards match this binder's rules.{' '}
          <button
            className="btn"
            style={{ marginLeft: 8 }}
            onClick={() => setEditingBinder(active.def.id)}
          >
            Edit rules
          </button>
          <button
            className="btn btn-danger"
            style={{ marginLeft: 8 }}
            onClick={() => handleDelete(active.def.id, active.def.name)}
          >
            Delete binder
          </button>
        </div>
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <SectionList
        viewKey={active.def.id}
        binderName={active.def.name}
        totalPages={active.totalPages}
        sections={active.sections}
        pocketSize={active.effectivePocketSize}
        editSorts={active.def.sorts}
        valueOrders={active.def.sortValueOrders ?? {}}
        sortEditable={active.def.mode !== 'manual' && !active.def.manualOrder?.length}
        onSortsChange={(next) => updateBinder(active.def.id, { sorts: next })}
        onValueOrdersChange={(next) => updateBinder(active.def.id, { sortValueOrders: next })}
        viewToggle={viewToggle}
        qtyByCopyId={qtyByCopyId}
        showImages={showImages}
        onDelete={() => handleDelete(active.def.id, active.def.name)}
      />
      {confirmDialog}
    </>
  );
}

function SectionList({
  viewKey,
  binderName,
  totalPages,
  sections,
  pocketSize,
  editSorts,
  valueOrders,
  sortEditable,
  onSortsChange,
  onValueOrdersChange,
  viewToggle,
  qtyByCopyId,
  showImages,
  onDelete,
}: {
  viewKey: string;
  binderName: string;
  totalPages: number;
  sections: BinderSection[];
  pocketSize: PocketSize;
  editSorts: SortEntry[];
  valueOrders: Partial<Record<SortField, string[]>>;
  sortEditable: boolean;
  onSortsChange: (next: SortEntry[]) => void;
  onValueOrdersChange: (next: Partial<Record<SortField, string[]>>) => void;
  viewToggle?: React.ReactNode;
  qtyByCopyId?: Map<string, number>;
  showImages?: boolean;
  onDelete?: () => void;
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
  const editingQty = useMemo(() => {
    if (!editingCard) return 0;
    return allCards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.foil === editingCard.foil
    ).length;
  }, [editingCard, allCards]);

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingCard) return;
    const sc = selection.card;
    const firstFace = sc.card_faces?.[0];
    const cardFields: Partial<EnrichedCard> = {
      scryfallId: sc.id,
      name: sc.name,
      setCode: sc.set.toUpperCase(),
      setName: sc.set_name,
      collectorNumber: sc.collector_number,
      rarity: sc.rarity,
      finish: selection.finish,
      foil: selection.finish !== 'nonfoil',
      imageSmall: sc.image_uris?.small ?? firstFace?.image_uris?.small,
      imageNormal: sc.image_uris?.normal ?? firstFace?.image_uris?.normal,
      imageLarge: sc.image_uris?.large ?? firstFace?.image_uris?.large,
      imageNormalBack: sc.card_faces?.[1]?.image_uris?.normal,
      imageLargeBack: sc.card_faces?.[1]?.image_uris?.large,
      frameEffects: sc.frame_effects,
      fullArt: sc.full_art === true || sc.frame_effects?.includes('fullart'),
      borderColor: sc.border_color,
      layout: sc.layout,
      finishes: sc.finishes,
      promoTypes: sc.promo_types,
      purchasePrice: pickPrice(sc, selection.finish !== 'nonfoil'),
      pricedAt: Date.now(),
    };
    const existing = allCards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.finish === editingCard.finish
    );
    const targetQty = selection.quantity ?? existing.length;
    const others = allCards.filter(
      (c) => !(c.scryfallId === editingCard.scryfallId && c.finish === editingCard.finish)
    );
    const updated = existing
      .slice(0, targetQty)
      .map((c) => ({ ...c, ...cardFields, copyId: c.copyId }));
    const added: EnrichedCard[] = [];
    for (let i = updated.length; i < targetQty; i++) {
      added.push({
        ...editingCard,
        ...cardFields,
        copyId: crypto.randomUUID(),
        sourceCategory: editingCard.sourceCategory,
        sourceFormat: editingCard.sourceFormat,
        importId: editingCard.importId,
      } as EnrichedCard);
    }
    replaceAllCards([...others, ...updated, ...added]);
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
  const sectionPageOffsets = useMemo(() => {
    return sections.reduce<{ offsets: number[]; total: number }>(
      (acc, s) => {
        acc.offsets.push(acc.total);
        return { offsets: acc.offsets, total: acc.total + s.pages.length };
      },
      { offsets: [], total: 0 }
    ).offsets;
  }, [sections]);

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
        <span className="binder-summary-meta">
          {flatPages.length > 0 && (
            <>
              <button
                type="button"
                className="binder-summary-open"
                onClick={() => setPagesStartIndex(0)}
                aria-label={`Browse pages of ${binderName}`}
              >
                Browse pages
              </button>
              {' · '}
            </>
          )}
          <Legend />
        </span>
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
            className="btn-link binder-summary-collapse"
            onClick={allCollapsed ? expandAll : collapseAll}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
        {onDelete && (
          <button type="button" className="btn-link binder-summary-delete" onClick={onDelete}>
            Delete binder
          </button>
        )}
        {viewToggle && <div className="binder-summary-viewmode">{viewToggle}</div>}
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
          binderName={binderName}
          resolveCard={resolveCard}
          qtyByCopyId={qtyByCopyId}
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
          quantity={editingQty}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditingCard(null)}
        />
      )}
    </>
  );
}

// Build a parallel array mapping each card in `section.cards` to the page
// number it lives on. Used by both previews to show "p.N" alongside a card.
/** Map a color section key (W/U/B/R/G/M/C/L/?) to its mana-font class. */
function colorKeyToMs(key: string): string {
  switch (key) {
    case 'W':
    case 'U':
    case 'B':
    case 'R':
    case 'G':
      return `ms-${key.toLowerCase()}`;
    case 'M':
      return 'ms-multicolor';
    case 'C':
    case 'L':
      return 'ms-c';
    default:
      return 'ms-c';
  }
}

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
        {section.pip && (
          <i
            className={`ms ${colorKeyToMs(section.key)} ms-cost color-pip-mana color-pip-mana--lg`}
            aria-hidden
          />
        )}
        <span className="section-title">{section.label}</span>
        <span className="section-meta">
          {section.cards.length} cards · {section.pages.length} page
          {section.pages.length !== 1 ? 's' : ''}
        </span>
      </button>
      {!isCollapsed && (
        <CardPreviewContext.Provider value={ctxValue}>
          <div id={panelId} role="region" aria-labelledby={headerId} className="page-row">
            {section.pages.map((page, idx) => (
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
        </CardPreviewContext.Provider>
      )}
    </div>
  );
});
