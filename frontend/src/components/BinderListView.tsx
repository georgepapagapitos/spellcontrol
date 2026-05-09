import { useCallback, useMemo, useState } from 'react';
import type { EnrichedCard, MaterializedBinder, SortField } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { CardPreview } from './CardPreview';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';
import { ManaCost } from './ManaCost';
import { useCollectionStore } from '../store/collection';
import { getColorKey, COLOR_INFO } from '../lib/colors';
import { SORT_FIELDS } from '../lib/sorting';
import { Legend } from './Legend';
import { BinderPagePreview } from './BinderPagePreview';
import { DeckBadge } from './DeckBadge';
import { useAllocations, type AllocationInfo } from '../lib/allocations';

const SORT_LABEL: Record<SortField, string> = SORT_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.label }),
  {} as Record<SortField, string>
);

interface Props {
  binder: MaterializedBinder;
  /** Optional slot rendered in the summary line next to "Collapse all". */
  viewToggle?: React.ReactNode;
  /** Roll duplicate copies of the same printing into one row. */
  groupPrintings?: boolean;
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
export function BinderListView({ binder, viewToggle, groupPrintings = false }: Props) {
  const allCards = useCollectionStore((s) => s.cards);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const allocations = useAllocations();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [editingCard, setEditingCard] = useState<EnrichedCard | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pagesStartIndex, setPagesStartIndex] = useState<number | null>(null);

  /** All deck allocations covering the copies that match (scryfallId, foil). */
  const allocationsFor = (card: EnrichedCard): AllocationInfo[] => {
    const out: AllocationInfo[] = [];
    for (const c of allCards) {
      if (c.scryfallId !== card.scryfallId || c.foil !== card.foil) continue;
      const a = allocations.get(c.copyId);
      if (a) out.push(a);
    }
    return out;
  };

  // Sort breadcrumb (e.g. "color › cmc › name") shown on each section
  // header so the binder's grouping/ordering hierarchy is visible at a
  // glance — same affordance the page-grid view exposes.
  const sortBreadcrumb = useMemo(() => {
    const active = binder.effectiveSorts.filter((s) => s && s !== 'none');
    return active.map((s) => SORT_LABEL[s] ?? s);
  }, [binder.effectiveSorts]);

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

  // Build a flat view of rows per section. Default mode is one row per
  // physical copy — matches what's in a real binder slot — and each row
  // shows its own page number. The grouped variant rolls duplicates of
  // the same printing into a single row with a qty pill.
  const flat = useMemo(() => {
    const cards: EnrichedCard[] = [];
    const sectionLabels: string[] = [];
    const pageNumbers: number[] = [];
    const sectionRows: { sectionKey: string; rows: Row[] }[] = [];
    for (const section of binder.sections) {
      // Map every concrete card reference to the page it lives on. Keying
      // by reference (not scryfallId) is correct for non-grouped mode
      // because two copies of the same printing land on different pages.
      const cardToPage = new Map<EnrichedCard, number>();
      for (const page of section.pages) {
        for (const slot of page.slots) {
          if (slot && !cardToPage.has(slot)) cardToPage.set(slot, page.pageNum);
        }
      }
      const rows: Row[] = [];
      if (groupPrintings) {
        const folded = new Map<string, Row>();
        for (const card of section.cards) {
          const key = `${card.scryfallId}:${card.foil ? 1 : 0}`;
          const pageNum = cardToPage.get(card) ?? 0;
          const existing = folded.get(key);
          if (existing) {
            existing.qty += 1;
            // Keep the earliest non-zero page so users find the start of
            // a multi-copy run.
            if (pageNum > 0 && (existing.pageNum === 0 || pageNum < existing.pageNum)) {
              existing.pageNum = pageNum;
            }
          } else {
            folded.set(key, { key, card, qty: 1, pageNum });
          }
        }
        rows.push(...folded.values());
      } else {
        section.cards.forEach((card, idx) => {
          rows.push({
            // copyId is unique per physical copy; falling back to idx for
            // any malformed card without one keeps keys stable per render.
            key: card.copyId ?? `${section.key}-${idx}`,
            card,
            qty: 1,
            pageNum: cardToPage.get(card) ?? 0,
          });
        });
      }
      sectionRows.push({ sectionKey: section.key, rows });
      // Parallel arrays for the preview carousel — one entry per UNIQUE
      // printing (matching the visible rows).
      for (const r of rows) {
        cards.push(r.card);
        sectionLabels.push(section.label);
        pageNumbers.push(r.pageNum);
      }
    }
    return { cards, sectionLabels, pageNumbers, sectionRows };
  }, [binder, groupPrintings]);

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
      foil: selection.foil,
      imageSmall: sc.image_uris?.small ?? firstFace?.image_uris?.small,
      imageNormal: sc.image_uris?.normal ?? firstFace?.image_uris?.normal,
      imageNormalBack: sc.card_faces?.[1]?.image_uris?.normal,
      frameEffects: sc.frame_effects,
      fullArt: sc.full_art === true || sc.frame_effects?.includes('fullart'),
      borderColor: sc.border_color,
      layout: sc.layout,
      finishes: sc.finishes,
      promoTypes: sc.promo_types,
      purchasePrice: pickPrice(sc, selection.foil),
      pricedAt: Date.now(),
    };
    const existing = allCards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.foil === editingCard.foil
    );
    const targetQty = selection.quantity ?? existing.length;
    const others = allCards.filter(
      (c) => !(c.scryfallId === editingCard.scryfallId && c.foil === editingCard.foil)
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
        {flat.sectionRows.length > 1 && (
          <button
            type="button"
            className="btn-link binder-summary-collapse"
            onClick={allCollapsed ? expandAll : collapseAll}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
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
          <div key={sectionKey} className="binder-section">
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
              {section.pip && (
                <i
                  className={`ms ${colorKeyToMs(section.key)} ms-cost color-pip-mana color-pip-mana--lg`}
                  aria-hidden
                />
              )}
              <span className="section-title">{section.label}</span>
              {sortBreadcrumb.length > 0 && (
                <span className="section-breadcrumb" aria-label="Sort order">
                  {sortBreadcrumb.join(' › ')}
                </span>
              )}
              <span className="section-meta">
                {totalQty} {totalQty === 1 ? 'card' : 'cards'}
                {groupPrintings && totalQty !== rows.length && ` · ${rows.length} unique`}
              </span>
            </button>
            {!isCollapsed && (
              <div
                id={panelId}
                role="region"
                aria-labelledby={headerId}
                className="collection-list"
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
                          {r.card.foil && <span className="card-list-foil-tag">foil</span>}
                          <DeckBadge allocations={allocationsFor(r.card)} />
                        </div>
                        <div className="collection-list-meta">
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
                        <button
                          type="button"
                          className="card-edit-btn"
                          title="Edit printing"
                          aria-label={`Edit printing for ${r.card.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCard(r.card);
                          }}
                        >
                          <PencilIcon />
                        </button>
                        {r.qty > 1 && <div className="collection-list-qty">×{r.qty}</div>}
                        <div className="collection-list-price">
                          ${(r.card.purchasePrice * r.qty).toFixed(2)}
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
          cards={flat.cards}
          index={previewIndex}
          binderName={binder.def.name}
          sectionLabels={flat.sectionLabels}
          pageNumbers={flat.pageNumbers}
          totalPages={binder.totalPages}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}

      {editingCard && (
        <CardEditDialog
          cardName={editingCard.name}
          currentScryfallId={editingCard.scryfallId}
          currentFoil={editingCard.foil}
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
          onClose={() => setPagesStartIndex(null)}
        />
      )}
    </>
  );
}

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

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}
