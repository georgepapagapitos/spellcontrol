import { useCallback, useMemo, useState } from 'react';
import type { EnrichedCard, MaterializedBinder } from '../types';
import { CardRowMenu } from './CardRowMenu';
import { FoilBadge } from './FoilBadge';
import type { ScryfallCard } from '@/deck-builder/types';
import { CardPreview } from './CardPreview';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';
import { ManaCost } from './ManaCost';
import { ColorPip } from './shared/ManaSymbol';
import { SetSymbol } from './shared/SetSymbol';
import { setSymbolTitle } from '../lib/set-symbols';
import { useCollectionStore } from '../store/collection';
import { getColorKey, COLOR_INFO } from '../lib/colors';
import { formatMoney } from '../lib/format-money';
import { SortPopover } from './SortPopover';
import { Legend } from './Legend';
import { BinderPagePreview } from './BinderPagePreview';
import { DeckBadge } from './DeckBadge';
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
  onDelete?: () => void;
}

interface Row {
  key: string;
  card: EnrichedCard;
  qty: number;
  /** First page number this card lands on inside its section. */
  pageNum: number;
}

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

/**
 * List view for a single binder that PRESERVES the section grouping the
 * binder's sort produces — same color / type / cmc headers as the page
 * grid view. Sister to CardListTable, but binder-scoped: rows live under
 * their section header instead of being globally sorted into a flat list.
 */
export function BinderListView({
  binder,
  viewToggle,
  qtyByCopyId,
  density = 'detail',
  onDelete,
}: Props) {
  const isCompact = density === 'compact';
  const isGrouped = !!qtyByCopyId;
  const allCards = useCollectionStore((s) => s.cards);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const updateBinder = useCollectionStore((s) => s.updateBinder);
  const sortEditable = binder.def.mode !== 'manual' && !binder.def.manualOrder?.length;
  const allocations = useAllocations();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [editingCard, setEditingCard] = useState<EnrichedCard | null>(null);
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

  const editingQty = useMemo(() => {
    if (!editingCard) return 0;
    return allCards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.foil === editingCard.foil
    ).length;
  }, [editingCard, allCards]);

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
        <span className="binder-summary-meta">
          {flatPages.length > 0 && (
            <>
              <button
                type="button"
                className="binder-summary-open"
                onClick={() => setPagesStartIndex(0)}
                aria-label={`Browse pages of ${binder.def.name}`}
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
            sorts={binder.def.sorts}
            valueOrders={binder.def.sortValueOrders ?? {}}
            onSortsChange={(next) => updateBinder(binder.def.id, { sorts: next })}
            onValueOrdersChange={(next) => updateBinder(binder.def.id, { sortValueOrders: next })}
          />
        )}
        {flat.sectionRows.length > 1 && (
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
                {rows.map((r) => {
                  const colorKey = getColorKey(r.card);
                  return (
                    <div
                      key={r.key}
                      className="collection-list-row"
                      role="row"
                      tabIndex={0}
                      onClick={() => {
                        const idx = previewIndexFor.get(`${sectionKey}:${r.key}`);
                        if (idx !== undefined) setPreviewIndex(idx);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          const idx = previewIndexFor.get(`${sectionKey}:${r.key}`);
                          if (idx !== undefined) setPreviewIndex(idx);
                        }
                      }}
                    >
                      {r.card.imageSmall ? (
                        <img
                          src={r.card.imageSmall}
                          alt=""
                          loading="lazy"
                          className="collection-list-thumb"
                        />
                      ) : (
                        <div
                          className="collection-list-thumb collection-list-thumb-placeholder"
                          style={{ background: COLOR_INFO[colorKey]?.pip }}
                          aria-hidden
                        />
                      )}
                      <div className="collection-list-main">
                        <div className="collection-list-name">
                          {r.card.name}
                          {r.card.foil && <FoilBadge card={r.card} showLabel />}
                          <DeckBadge allocations={allocationsFor(r.card)} />
                        </div>
                        <div className="collection-list-meta">
                          <SetSymbol
                            setCode={r.card.setCode}
                            rarity={r.card.rarity}
                            title={setSymbolTitle({
                              setCode: r.card.setCode,
                              setName: r.card.setName,
                              collectorNumber: r.card.collectorNumber,
                              rarity: r.card.rarity,
                            })}
                          />
                          <span className="card-list-set-code">{r.card.setCode.toUpperCase()}</span>
                          <span className="card-list-cn">#{r.card.collectorNumber}</span>
                          {r.pageNum > 0 && (
                            <span className="card-list-page" title={`Page ${r.pageNum}`}>
                              p.{r.pageNum}
                            </span>
                          )}
                          <ManaCost cost={r.card.manaCost} />
                        </div>
                      </div>
                      <div className="collection-list-right">
                        <CardRowMenu
                          card={r.card}
                          onEditCard={() => setEditingCard(r.card)}
                          currentBinder={{
                            id: binder.def.id,
                            name: binder.def.name,
                            color: binder.def.color,
                          }}
                        />
                        {r.qty > 1 && <div className="collection-list-qty">×{r.qty}</div>}
                        <div className="collection-list-price">
                          {formatMoney(r.card.purchasePrice * r.qty)}
                        </div>
                      </div>
                    </div>
                  );
                })}
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

      {pagesStartIndex !== null && (
        <BinderPagePreview
          pages={flatPages}
          pageLabels={flatPageLabels}
          startPageIndex={pagesStartIndex}
          pocketSize={binder.effectivePocketSize}
          binderName={binder.def.name}
          resolveCard={resolveCard}
          qtyByCopyId={qtyByCopyId}
          onClose={() => setPagesStartIndex(null)}
          onEditCard={(c) => {
            setPagesStartIndex(null);
            setEditingCard(c);
          }}
        />
      )}
    </>
  );
}
