import {
  BookOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  Image as ImageIcon,
  ImageOff,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { EnrichedCard, MaterializedBinder } from '../types';
import { CardRowMenu } from './CardRowMenu';
import { CardPreview, type CardPreviewAction } from './CardPreview';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';
import { ColorPip } from './shared/ManaSymbol';
import { CardRow } from './shared/CardRow';
import { SectionHeaderBar } from './shared/SectionHeaderBar';
import {
  BINDER_TABLE_COLUMNS,
  CardTableFrame,
  CardTableHead,
  visibleColumns,
} from './shared/CardTable';
import { useMediaQuery } from '../lib/use-media-query';
import {
  buildEditedCards,
  isNoOpCardEdit,
  stackCopies,
  stackDetailMix,
  printingStubFromEnriched,
} from '../lib/edit-card';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';
import { SortPopover } from './SortPopover';
import { Legend } from './Legend';
import { BinderPagePreview } from './BinderPagePreview';
import { useAllocations, type AllocationInfo } from '../lib/allocations';
import { sectionHeading } from '../lib/section-heading';
import { printingFinishKey } from '../lib/collection-mutations';

interface Props {
  binder: MaterializedBinder;
  /** Optional slot rendered in the summary line next to "Collapse all". */
  viewToggle?: React.ReactNode;
  /**
   * When the page-level groupPrintings flag is on, the materializer feeds
   * one card per unique (scryfallId × foil); the qty for each surviving
   * copy lives here keyed by copyId. If undefined, every row is a single
   * physical copy (qty 1).
   */
  qtyByCopyId?: Map<string, number>;
  /** 'detail' = thumbnail + multi-line meta. 'compact' = text-only single line. */
  density?: 'detail' | 'compact';
}

/**
 * A section's tally. Both numbers matter in a binder: the card count is how
 * many sleeves the section fills, the unique count how many distinct printings
 * — a playset of Path to Exile is four of one. They're only shown apart when
 * they differ.
 */
function sectionMeta(totalQty: number, uniqueRows: number): string {
  const cards = `${totalQty} ${totalQty === 1 ? 'card' : 'cards'}`;
  return totalQty === uniqueRows ? cards : `${cards} · ${uniqueRows} unique`;
}

interface Row {
  key: string;
  card: EnrichedCard;
  qty: number;
  /** First page number this card lands on inside its section. */
  pageNum: number;
}

/**
 * List view for a single binder that PRESERVES the section grouping the
 * binder's sort produces — same color / type / cmc headers as the page
 * grid view. Sister to CardListTable, but binder-scoped: rows live under
 * their section header instead of being globally sorted into a flat list.
 */
export function BinderListView({ binder, viewToggle, qtyByCopyId, density = 'detail' }: Props) {
  const isCompact = density === 'compact';
  // Compact becomes the shared card table from tablet width up, exactly as
  // Collection's does — same row component, same columns, same widths. Below
  // that the columns don't fit and compact stays the text-only flow row.
  // Binder order is rule-driven (the SortPopover above owns it), so the
  // header labels its columns without offering click-to-sort.
  const wideEnoughForTable = useMediaQuery('(min-width: 768px)');
  const isTable = isCompact && wideEnoughForTable;
  const isGrouped = !!qtyByCopyId;
  const allCards = useCollectionStore((s) => s.cards);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const updateBinder = useCollectionStore((s) => s.updateBinder);
  const isRefreshingPrices = useCollectionStore((s) => s.isRefreshingPrices);
  const pushToast = useToastsStore((s) => s.push);
  const sortEditable = binder.def.mode !== 'manual' && !binder.def.manualOrder?.length;
  const allocations = useAllocations();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [editingCard, setEditingCard] = useState<EnrichedCard | null>(null);
  // True when editing a single physical copy vs the whole printing stack:
  // always so in ungrouped view, and when "Change one copy's printing" splits
  // one copy off a grouped 2+ stack.
  const [editingSingle, setEditingSingle] = useState(false);
  const openEdit = (card: EnrichedCard, single: boolean) => {
    setEditingCard(card);
    setEditingSingle(single);
  };
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pagesStartIndex, setPagesStartIndex] = useState<number | null>(null);

  // "Set cover" / "Remove cover" in the card preview's icon bar — the explicit
  // override for the index tile's cover art (lib/binder-cover.ts). Only offered
  // for cards that actually have art to show. Mirrors BinderView.
  const coverActions = (card: EnrichedCard | undefined): CardPreviewAction[] => {
    if (!card?.imageNormal) return [];
    const isCover = binder.def.coverScryfallId === card.scryfallId;
    return [
      {
        key: 'cover',
        label: isCover ? 'Remove cover' : 'Set cover',
        icon: isCover ? (
          <ImageOff width={18} height={18} strokeWidth={2} aria-hidden />
        ) : (
          <ImageIcon width={18} height={18} strokeWidth={2} aria-hidden />
        ),
        onClick: () => {
          updateBinder(binder.def.id, {
            coverScryfallId: isCover ? undefined : card.scryfallId,
          });
          pushToast({
            message: isCover
              ? 'Cover follows the most valuable card again.'
              : `${card.name} is now this binder's cover.`,
            tone: 'success',
          });
        },
      },
    ];
  };

  /**
   * Deck allocations for a row. Ungrouped rows stand for exactly one
   * physical copy, so we look up that single copyId. Grouped rows stand in
   * for every copy of (scryfallId, foil), so we aggregate.
   */
  const allocationsFor = (card: EnrichedCard, qty = qtyOf(card)): AllocationInfo[] => {
    if (!isGrouped && qty <= 1) {
      const a = allocations.get(card.copyId);
      return a ? [a] : [];
    }
    const out: AllocationInfo[] = [];
    for (const c of allCards) {
      if (c.scryfallId !== card.scryfallId || c.foil !== card.foil) continue;
      const a = allocations.get(c.copyId);
      if (a) out.push(a);
    }
    return out;
  };

  // Flat page list for "Browse pages" — opens the BinderPagePreview at
  // the first page; same carousel the grid view uses.
  const flatPages = useMemo(
    () =>
      binder.sections.flatMap((s) =>
        s.pages.map((page) => ({ pageNum: page.pageNum, slots: page.slots }))
      ),
    [binder.sections]
  );
  // Merged (packed/continuous) sections stamp each page with its own group
  // labels; prefer those over the section-wide join, matching BinderView.
  const flatPageLabels = useMemo(
    () => binder.sections.flatMap((s) => s.pages.map((p) => p.labels?.join(' · ') ?? s.label)),
    [binder.sections]
  );

  // Build rows per section. The binder is materialized physically — one
  // card per copy, so page numbers and totals are the real binder — and the
  // LIST collapses identical adjacent copies into one row with a ×N badge:
  // seven "Mountain SLD #2418" rows say nothing seven times. Identical
  // printings always sort adjacent (they tie on every field), so a run is
  // exactly one printing's stack; the row keeps the first copy's page. When
  // the page grid's "Group printings" mode is on the materializer has
  // already collapsed to one card per (scryfallId × foil) and `qtyByCopyId`
  // carries the totals instead.
  const flat = useMemo(() => {
    const cards: EnrichedCard[] = [];
    const sectionLabels: string[] = [];
    const pageNumbers: number[] = [];
    const qtys: number[] = [];
    const qtyByCopy = new Map<string, number>();
    const sectionRows: { sectionKey: string; rows: Row[] }[] = [];
    for (const section of binder.sections) {
      const cardToPage = new Map<EnrichedCard, number>();
      for (const page of section.pages) {
        for (const slot of page.slots) {
          if (slot && !cardToPage.has(slot)) cardToPage.set(slot, page.pageNum);
        }
      }
      const rows: Row[] = [];
      section.cards.forEach((card, idx) => {
        const prev = rows[rows.length - 1];
        if (!qtyByCopyId && prev && printingFinishKey(prev.card) === printingFinishKey(card)) {
          prev.qty += 1;
          return;
        }
        rows.push({
          // copyId is unique per physical copy; in grouped mode it's the
          // surviving representative, also unique. Fallback for safety.
          key: card.copyId ?? `${section.key}-${idx}`,
          card,
          qty: qtyByCopyId?.get(card.copyId) ?? 1,
          pageNum: cardToPage.get(card) ?? 0,
        });
      });
      sectionRows.push({ sectionKey: section.key, rows });
      rows.forEach((r) => {
        const i = section.cards.indexOf(r.card);
        cards.push(r.card);
        sectionLabels.push(section.cardLabels?.[i] ?? section.label);
        pageNumbers.push(r.pageNum);
        qtys.push(r.qty);
        qtyByCopy.set(r.card.copyId, r.qty);
      });
    }
    return { cards, sectionLabels, pageNumbers, qtys, qtyByCopy, sectionRows };
  }, [binder, qtyByCopyId]);
  const qtyOf = (card: EnrichedCard) => flat.qtyByCopy.get(card.copyId) ?? 1;

  // Cond, Lang and Notes earn their tracks only if some copy on this page has
  // something to put in them — otherwise the binder spends three columns, one
  // of them two `fr` wide, saying NM / EN / nothing a thousand times over.
  const columns = useMemo(() => visibleColumns(BINDER_TABLE_COLUMNS, flat.cards), [flat.cards]);

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const editingQty = useMemo(() => {
    if (!editingCard) return 0;
    return allCards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.foil === editingCard.foil
    ).length;
  }, [editingCard, allCards]);
  // Only meaningful for a grouped (stacked) edit — a single-copy edit is
  // trivially uniform. Mirrors the exact scryfallId+finish match
  // buildEditedCards edits by.
  const editingMixedDetails = useMemo(() => {
    if (!editingCard || editingSingle) return undefined;
    return stackDetailMix(stackCopies(allCards, editingCard));
  }, [editingCard, editingSingle, allCards]);

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingCard) return;
    // Single-copy edit re-points just this one copy, leaving siblings on the old
    // printing — that's how a stack of identical printings gets split.
    const copyId = editingSingle ? editingCard.copyId : undefined;
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

  // Map each visible row to its index in the flat preview array.
  const previewIndexFor = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const sec of flat.sectionRows) {
      for (const r of sec.rows) {
        map.set(`${sec.sectionKey}:${r.key}`, i);
        i++;
      }
    }
    return map;
  }, [flat]);

  // Tap a card inside the page-grid preview → walk the binder's flat
  // card list from the matching index. Same shape BinderView's
  // resolveCard returns.
  const resolveCard = useCallback(
    (card: EnrichedCard) => {
      const idx = flat.cards.findIndex(
        (c) => c.scryfallId === card.scryfallId && c.foil === card.foil
      );
      if (idx === -1) return null;
      return {
        cards: flat.cards,
        index: idx,
        sectionLabels: flat.sectionLabels,
        pageNumbers: flat.pageNumbers,
        totalPages: binder.totalPages,
      };
    },
    [flat, binder.totalPages]
  );

  const allCollapsed =
    flat.sectionRows.length > 0 &&
    flat.sectionRows.every(({ sectionKey }) => collapsed.has(sectionKey));
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(flat.sectionRows.map((s) => s.sectionKey)));

  return (
    <>
      <div className="binder-summary" aria-live="polite">
        {flatPages.length > 0 && (
          <button
            type="button"
            className="binder-summary-browse-pages"
            onClick={() => setPagesStartIndex(0)}
            aria-label={`Browse pages of ${binder.def.name}`}
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
            sorts={binder.def.sorts}
            valueOrders={binder.def.sortValueOrders ?? {}}
            onSortsChange={(next) => updateBinder(binder.def.id, { sorts: next })}
            onValueOrdersChange={(next) => updateBinder(binder.def.id, { sortValueOrders: next })}
          />
        )}
        {flat.sectionRows.length > 1 && (
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
      <CardTableFrame columns={columns} framed={isTable}>
        {isTable && <CardTableHead columns={columns} />}
        {flat.sectionRows.map(({ sectionKey, rows }, sectionIdx) => {
          const section = binder.sections.find((s) => s.key === sectionKey);
          if (!section) return null;
          const isCollapsed = collapsed.has(sectionKey);
          const headerId = `binder-list-section-${sectionKey}`;
          const panelId = `binder-list-panel-${sectionKey}`;
          const totalQty = rows.reduce((s, r) => s + r.qty, 0);
          return (
            <div
              key={sectionKey}
              className={
                isTable
                  ? 'binder-table-group'
                  : `binder-section binder-section--list${isCompact ? ' binder-section--compact' : ''}`
              }
            >
              {isTable ? (
                // In the table the divider is a ROW of the table, not a bar
                // floating above a separate box — same bar Collection's
                // grouped list uses, so the two can't drift apart again.
                <SectionHeaderBar
                  className="collection-list-section-header binder-table-section"
                  id={headerId}
                  controls={panelId}
                  pipSlot={section.pip ? <ColorPip color={section.key} pip="lg" /> : undefined}
                  label={sectionHeading(section.cardLabels, section.label)}
                  title={section.label}
                  count={totalQty}
                  meta={sectionMeta(totalQty, rows.length)}
                  collapsed={isCollapsed}
                  onToggle={() => toggle(sectionKey)}
                />
              ) : (
                <button
                  type="button"
                  id={headerId}
                  className={`section-header section-header-toggle ${isCollapsed ? 'collapsed' : ''}`}
                  onClick={() => toggle(sectionKey)}
                  aria-expanded={!isCollapsed}
                  aria-controls={panelId}
                >
                  <span className="section-chevron" aria-hidden="true">
                    ▾
                  </span>
                  {section.pip && <ColorPip color={section.key} pip="lg" />}
                  <span className="section-title" title={section.label}>
                    {sectionHeading(section.cardLabels, section.label)}
                  </span>
                  <span className="section-meta">{sectionMeta(totalQty, rows.length)}</span>
                </button>
              )}
              {!isCollapsed && (
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={headerId}
                  className={`collection-list${isTable ? ' is-table' : isCompact ? ' is-compact' : ''}`}
                >
                  {rows.map((r, rowIdx) => (
                    <CardRow
                      key={r.key}
                      card={r.card}
                      qty={r.qty}
                      // Only the very last row in the slab drops its divider;
                      // a section's last row still needs one, because a group
                      // row follows it.
                      isLastRow={
                        isTable &&
                        sectionIdx === flat.sectionRows.length - 1 &&
                        rowIdx === rows.length - 1
                      }
                      columns={isTable ? columns : undefined}
                      allocations={allocationsFor(r.card, r.qty)}
                      pageNum={r.pageNum}
                      pricePending={isRefreshingPrices && !((r.card.purchasePrice ?? 0) > 0)}
                      onActivate={() => {
                        const idx = previewIndexFor.get(`${sectionKey}:${r.key}`);
                        if (idx !== undefined) setPreviewIndex(idx);
                      }}
                      menu={
                        <CardRowMenu
                          card={r.card}
                          onEditCard={() => openEdit(r.card, r.qty === 1)}
                          onSplitCopy={r.qty >= 2 ? () => openEdit(r.card, true) : undefined}
                          currentBinder={{
                            id: binder.def.id,
                            name: binder.def.name,
                            color: binder.def.color,
                          }}
                        />
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardTableFrame>

      {previewIndex !== null && (
        <CardPreview
          source="binder"
          cards={flat.cards}
          index={previewIndex}
          binderName={binder.def.name}
          sectionLabels={flat.sectionLabels}
          pageNumbers={flat.pageNumbers}
          totalPages={binder.totalPages}
          getStackAllocations={(i) => allocationsFor(flat.cards[i])}
          getStackQty={(i) => flat.qtys[i] ?? 1}
          getActions={(i) => coverActions(flat.cards[i])}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          onEdit={(c) => {
            setPreviewIndex(null);
            openEdit(c, qtyOf(c) === 1);
          }}
        />
      )}

      {editingCard && (
        <CardEditDialog
          cardName={editingCard.name}
          currentScryfallId={editingCard.scryfallId}
          fallbackCard={printingStubFromEnriched(editingCard)}
          currentFinish={editingCard.finish ?? (editingCard.foil ? 'foil' : 'nonfoil')}
          quantity={editingSingle ? undefined : editingQty}
          singleCopy={editingSingle}
          details={{
            condition: editingCard.condition,
            language: editingCard.language,
            notes: editingCard.notes,
            altered: editingCard.altered,
            proxy: editingCard.proxy,
            misprint: editingCard.misprint,
            acquiredPrice: editingCard.acquiredPrice,
            priceOverride: editingCard.priceOverride,
          }}
          mixedDetails={editingMixedDetails}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditingCard(null)}
        />
      )}

      {pagesStartIndex !== null && (
        <BinderPagePreview
          pages={flatPages}
          pageLabels={flatPageLabels}
          startPageIndex={pagesStartIndex}
          pocketSize={binder.effectivePocketSize}
          binderName={binder.def.name}
          resolveCard={resolveCard}
          qtyByCopyId={qtyByCopyId}
          getCardActions={coverActions}
          onClose={() => setPagesStartIndex(null)}
          onEditCard={(c) => {
            setPagesStartIndex(null);
            openEdit(c, qtyOf(c) === 1);
          }}
        />
      )}
    </>
  );
}
