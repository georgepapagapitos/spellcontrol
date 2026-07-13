import { BookOpen, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { EnrichedCard, MaterializedBinder } from '../types';
import { CardRowMenu } from './CardRowMenu';
import { CardPreview } from './CardPreview';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';
import { ColorPip } from './shared/ManaSymbol';
import { CardRow } from './shared/CardRow';
import { buildEditedCards, isNoOpCardEdit, stackCopies, stackDetailMix } from '../lib/edit-card';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';
import { SortPopover } from './SortPopover';
import { Legend } from './Legend';
import { BinderPagePreview } from './BinderPagePreview';
import type { SectionTabInput } from '../lib/binder-spreads';
import { useAllocations, type AllocationInfo } from '../lib/allocations';

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
  const isGrouped = !!qtyByCopyId;
  const allCards = useCollectionStore((s) => s.cards);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const updateBinder = useCollectionStore((s) => s.updateBinder);
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

  /**
   * Deck allocations for a row. Ungrouped rows stand for exactly one
   * physical copy, so we look up that single copyId. Grouped rows stand in
   * for every copy of (scryfallId, foil), so we aggregate.
   */
  const allocationsFor = (card: EnrichedCard): AllocationInfo[] => {
    if (!isGrouped) {
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
  const flatPageLabels = useMemo(
    () => binder.sections.flatMap((s) => s.pages.map(() => s.label)),
    [binder.sections]
  );

  // Section index tabs for spread mode — matches the BinderView computation.
  // Uses reduce to accumulate the running page-offset without mutating a
  // variable (required by the react-hooks/immutability lint rule).
  const sectionTabs = useMemo<SectionTabInput[]>(
    () =>
      binder.sections.reduce<{ tabs: SectionTabInput[]; offset: number }>(
        (acc, s) => ({
          tabs: [
            ...acc.tabs,
            { key: s.key, label: s.label, pip: s.pip, firstPageIndex: acc.offset },
          ],
          offset: acc.offset + s.pages.length,
        }),
        { tabs: [], offset: 0 }
      ).tabs,
    [binder.sections]
  );

  // Build rows per section. Each materialized card is one row — when the
  // binder is in group-printings mode the materializer has already fed
  // one card per unique (scryfallId × foil) and `qtyByCopyId` carries the
  // per-row total. Off-mode = one row per physical copy with qty 1.
  const flat = useMemo(() => {
    const cards: EnrichedCard[] = [];
    const sectionLabels: string[] = [];
    const pageNumbers: number[] = [];
    const sectionRows: { sectionKey: string; rows: Row[] }[] = [];
    for (const section of binder.sections) {
      const cardToPage = new Map<EnrichedCard, number>();
      for (const page of section.pages) {
        for (const slot of page.slots) {
          if (slot && !cardToPage.has(slot)) cardToPage.set(slot, page.pageNum);
        }
      }
      const rows: Row[] = section.cards.map((card, idx) => ({
        // copyId is unique per physical copy; in grouped mode it's the
        // surviving representative, also unique. Fallback for safety.
        key: card.copyId ?? `${section.key}-${idx}`,
        card,
        qty: qtyByCopyId?.get(card.copyId) ?? 1,
        pageNum: cardToPage.get(card) ?? 0,
      }));
      sectionRows.push({ sectionKey: section.key, rows });
      for (const r of rows) {
        cards.push(r.card);
        sectionLabels.push(section.label);
        pageNumbers.push(r.pageNum);
      }
    }
    return { cards, sectionLabels, pageNumbers, sectionRows };
  }, [binder, qtyByCopyId]);

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
      {flat.sectionRows.map(({ sectionKey, rows }) => {
        const section = binder.sections.find((s) => s.key === sectionKey);
        if (!section) return null;
        const isCollapsed = collapsed.has(sectionKey);
        const headerId = `binder-list-section-${sectionKey}`;
        const panelId = `binder-list-panel-${sectionKey}`;
        const totalQty = rows.reduce((s, r) => s + r.qty, 0);
        return (
          <div
            key={sectionKey}
            className={`binder-section binder-section--list${isCompact ? ' binder-section--compact' : ''}`}
          >
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
              <span className="section-title">{section.label}</span>
              <span className="section-meta">
                {totalQty} {totalQty === 1 ? 'card' : 'cards'}
                {isGrouped && totalQty !== rows.length && ` · ${rows.length} unique`}
              </span>
            </button>
            {!isCollapsed && (
              <div
                id={panelId}
                role="region"
                aria-labelledby={headerId}
                className={`collection-list${isCompact ? ' is-compact' : ''}`}
              >
                {rows.map((r) => (
                  <CardRow
                    key={r.key}
                    card={r.card}
                    qty={r.qty}
                    allocations={allocationsFor(r.card)}
                    pageNum={r.pageNum}
                    onActivate={() => {
                      const idx = previewIndexFor.get(`${sectionKey}:${r.key}`);
                      if (idx !== undefined) setPreviewIndex(idx);
                    }}
                    menu={
                      <CardRowMenu
                        card={r.card}
                        onEditCard={() => openEdit(r.card, !isGrouped)}
                        onSplitCopy={
                          isGrouped && r.qty >= 2 ? () => openEdit(r.card, true) : undefined
                        }
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
          getStackQty={(i) => {
            const c = flat.cards[i];
            return c ? (qtyByCopyId?.get(c.copyId) ?? 1) : 1;
          }}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          onEdit={(c) => {
            setPreviewIndex(null);
            openEdit(c, !isGrouped);
          }}
        />
      )}

      {editingCard && (
        <CardEditDialog
          cardName={editingCard.name}
          currentScryfallId={editingCard.scryfallId}
          currentFinish={editingCard.finish ?? (editingCard.foil ? 'foil' : 'nonfoil')}
          quantity={editingSingle ? undefined : editingQty}
          singleCopy={editingSingle}
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

      {pagesStartIndex !== null && (
        <BinderPagePreview
          pages={flatPages}
          pageLabels={flatPageLabels}
          startPageIndex={pagesStartIndex}
          pocketSize={binder.effectivePocketSize}
          doubleSided={binder.def.doubleSided}
          binderName={binder.def.name}
          resolveCard={resolveCard}
          qtyByCopyId={qtyByCopyId}
          sectionTabs={sectionTabs}
          onClose={() => setPagesStartIndex(null)}
          onEditCard={(c) => {
            setPagesStartIndex(null);
            openEdit(c, !isGrouped);
          }}
        />
      )}
    </>
  );
}
