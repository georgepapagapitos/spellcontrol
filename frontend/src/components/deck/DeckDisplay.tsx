import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { ManaCost } from '../ManaCost';
import { CardPreview } from '../CardPreview';
import { CardPreviewContext } from '../CardPreviewContext';
import { COLOR_INFO } from '../../lib/colors';
import { classifyAllocation, type AllocationStatus } from '../../lib/allocations';
import type { EnrichedCard } from '../../types';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';

// ── Canonical card-type grouping ──────────────────────────────────────────
const CLASSIFY_PRIORITY = [
  'Land',
  'Creature',
  'Planeswalker',
  'Battle',
  'Sorcery',
  'Instant',
  'Artifact',
  'Enchantment',
] as const;
type TypeGroup = (typeof CLASSIFY_PRIORITY)[number];

const DISPLAY_ORDER: TypeGroup[] = [
  'Planeswalker',
  'Creature',
  'Artifact',
  'Enchantment',
  'Instant',
  'Sorcery',
  'Battle',
  'Land',
];

function classifyType(card: ScryfallCard): TypeGroup {
  const tl = (card.type_line || '').toLowerCase();
  for (const group of CLASSIFY_PRIORITY) {
    if (tl.includes(group.toLowerCase())) return group;
  }
  return 'Artifact';
}

const TYPE_ICON: Record<TypeGroup, string> = {
  Land: 'ms-land',
  Creature: 'ms-creature',
  Planeswalker: 'ms-planeswalker',
  Battle: 'ms-battle',
  Sorcery: 'ms-sorcery',
  Instant: 'ms-instant',
  Artifact: 'ms-artifact',
  Enchantment: 'ms-enchantment',
};

// ── Helpers ───────────────────────────────────────────────────────────────
type CurrencyCode = 'USD' | 'EUR';

function priceOf(card: ScryfallCard, currency: CurrencyCode): number {
  const raw = getCardPrice(card, currency);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(value: number, currency: CurrencyCode): string {
  const symbol = currency === 'EUR' ? '€' : '$';
  return `${symbol}${value.toFixed(2)}`;
}

function rarityShort(rarity: string): { letter: string; cls: string } {
  switch (rarity) {
    case 'mythic':
      return { letter: 'M', cls: 'rarity-pill rarity-mythic' };
    case 'rare':
      return { letter: 'R', cls: 'rarity-pill rarity-rare' };
    case 'uncommon':
      return { letter: 'U', cls: 'rarity-pill rarity-uncommon' };
    case 'common':
      return { letter: 'C', cls: 'rarity-pill rarity-common' };
    case 'special':
      return { letter: 'S', cls: 'rarity-pill rarity-uncommon' };
    case 'bonus':
      return { letter: 'B', cls: 'rarity-pill rarity-rare' };
    default:
      return { letter: '·', cls: 'rarity-pill rarity-common' };
  }
}

function frontFaceMana(card: ScryfallCard): string | undefined {
  return card.mana_cost ?? card.card_faces?.[0]?.mana_cost;
}

function landProducedColors(card: ScryfallCard): string[] {
  const out = new Set<string>();
  for (const c of card.produced_mana || []) {
    if ('WUBRG'.includes(c)) out.add(c);
  }
  if (out.size > 0) return [...out];
  const tl = (card.type_line || '').toLowerCase();
  const ot = (card.oracle_text || '').toLowerCase();
  if (tl.includes('plains') || ot.includes('add {w}')) out.add('W');
  if (tl.includes('island') || ot.includes('add {u}')) out.add('U');
  if (tl.includes('swamp') || ot.includes('add {b}')) out.add('B');
  if (tl.includes('mountain') || ot.includes('add {r}')) out.add('R');
  if (tl.includes('forest') || ot.includes('add {g}')) out.add('G');
  if (ot.includes('any color') || ot.includes('any type')) {
    for (const c of 'WUBRG') out.add(c);
  }
  return [...out];
}

type SortMode = 'name' | 'cmc' | 'price' | 'color';

// ── Props ─────────────────────────────────────────────────────────────────
export interface DeckDisplayCard {
  /** Persisted slot id; when present, used for remove. Generated decks pre-save can omit this. */
  slotId?: string;
  card: ScryfallCard;
  /** scryfallId of the specific collection copy claimed by this slot, if any. */
  allocatedScryfallId?: string | null;
}

export interface DeckDisplayProps {
  title: string;
  commander: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  cards: DeckDisplayCard[];
  /** Optional grade/bracket — if provided, renders in the stats and toolbar. */
  bracketEstimation?: BracketEstimation;
  deckGrade?: { letter: string; headline: string };
  /** Role counts from the generator (only present on generated decks). */
  roleCounts?: Record<string, number>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  /** Editing callback. When provided, each row gets a remove (×) affordance. */
  onRemoveCard?: (slotId: string) => void;
  /** Lookup of owned cards by scryfallId, for allocation badges + status. */
  collectionByScryfallId?: Map<string, EnrichedCard>;
}

// ── Row shape ────────────────────────────────────────────────────────────
interface Row {
  name: string;
  qty: number;
  card: ScryfallCard;
  cmc: number;
  price: number;
  colorKey: string;
  /** Slot ids covered by this aggregated row (for remove-one). */
  slotIds: string[];
  /** Allocation status of this row, summarised across the slots it covers. */
  status: AllocationStatus;
}

function colorKeyOf(card: ScryfallCard): string {
  const ci = card.color_identity ?? [];
  if (ci.length === 0) return 'C';
  if (ci.length === 1) return ci[0];
  return 'M';
}

function buildRows(
  cards: DeckDisplayCard[],
  currency: CurrencyCode,
  collectionById: Map<string, EnrichedCard> | undefined
): Row[] {
  const map = new Map<string, Row>();
  for (const dc of cards) {
    const card = dc.card;
    const existing = map.get(card.name);
    const status = classifyAllocation(dc.allocatedScryfallId ?? null, collectionById ?? new Map());
    if (existing) {
      existing.qty += 1;
      existing.price += priceOf(card, currency);
      if (dc.slotId) existing.slotIds.push(dc.slotId);
      // Severity: orphan > unowned > allocated. Keep the most-noteworthy.
      if (statusSeverity(status) > statusSeverity(existing.status)) {
        existing.status = status;
      }
      continue;
    }
    map.set(card.name, {
      name: card.name,
      qty: 1,
      card,
      cmc: card.cmc ?? 0,
      price: priceOf(card, currency),
      colorKey: colorKeyOf(card),
      slotIds: dc.slotId ? [dc.slotId] : [],
      status,
    });
  }
  return [...map.values()];
}

function statusSeverity(s: AllocationStatus): number {
  return s === 'orphan' ? 2 : s === 'unowned' ? 1 : 0;
}

function sortRows(rows: Row[], mode: SortMode): Row[] {
  const sorted = [...rows];
  switch (mode) {
    case 'cmc':
      sorted.sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name));
      break;
    case 'price':
      sorted.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
      break;
    case 'color': {
      const order = (key: string) => COLOR_INFO[key]?.order ?? 99;
      sorted.sort((a, b) => order(a.colorKey) - order(b.colorKey) || a.name.localeCompare(b.name));
      break;
    }
    case 'name':
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

// ── Main component ────────────────────────────────────────────────────────
export function DeckDisplay({
  title,
  commander,
  partnerCommander,
  cards,
  bracketEstimation,
  deckGrade,
  roleCounts,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
  onRemoveCard,
  collectionByScryfallId,
}: DeckDisplayProps) {
  const currency: CurrencyCode = 'USD';
  const [sort, setSort] = useState<SortMode>('cmc');
  const [search, setSearch] = useState('');
  // Stats panel collapses on tablet/mobile via the toggle in its header.
  // On desktop the sidebar overrides the [hidden] body and toggle in CSS.
  const [statsOpen, setStatsOpen] = useState(true);

  // Commander rows are synthetic so they always render first; their slot
  // ids are blank because remove is not allowed on the commander.
  const commanderRows: Row[] = useMemo(() => {
    const rows: Row[] = [];
    const push = (c: ScryfallCard) => {
      rows.push({
        name: c.name,
        qty: 1,
        card: c,
        cmc: c.cmc ?? 0,
        price: priceOf(c, currency),
        colorKey: colorKeyOf(c),
        slotIds: [],
        status: 'allocated', // commanders are usually owned; if not, we don't badge them
      });
    };
    if (commander) push(commander);
    if (partnerCommander) push(partnerCommander);
    return rows;
  }, [commander, partnerCommander]);

  // Non-commander rows grouped by canonical type.
  const groups = useMemo(() => {
    const rows = buildRows(cards, currency, collectionByScryfallId);
    const buckets = new Map<TypeGroup, Row[]>();
    for (const row of rows) {
      const t = classifyType(row.card);
      const bucket = buckets.get(t) ?? [];
      bucket.push(row);
      buckets.set(t, bucket);
    }
    const ordered: { title: string; icon: string; rows: Row[] }[] = [];
    if (commanderRows.length > 0) {
      ordered.push({ title: 'Commander', icon: 'ms-planeswalker', rows: commanderRows });
    }
    for (const t of DISPLAY_ORDER) {
      const r = buckets.get(t);
      if (r && r.length > 0) ordered.push({ title: t, icon: TYPE_ICON[t], rows: r });
    }
    return ordered;
  }, [cards, commanderRows, collectionByScryfallId]);

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.map((g) => {
      const filtered = q ? g.rows.filter((r) => r.name.toLowerCase().includes(q)) : g.rows;
      return { ...g, rows: sortRows(filtered, sort) };
    });
  }, [groups, sort, search]);

  // Flat list for stats panels (commanders included, since color identity
  // and curve are commander-relevant too).
  const allCards = useMemo<ScryfallCard[]>(() => {
    const list: ScryfallCard[] = [];
    if (commander) list.push(commander);
    if (partnerCommander) list.push(partnerCommander);
    for (const dc of cards) list.push(dc.card);
    return list;
  }, [commander, partnerCommander, cards]);

  // Stats summary line.
  const totalCards = allCards.length;
  const totalPrice = useMemo(
    () => allCards.reduce((sum, c) => sum + priceOf(c, currency), 0),
    [allCards, currency]
  );
  const averageCmc = useMemo(() => {
    const nonLand = allCards.filter((c) => !(c.type_line || '').toLowerCase().includes('land'));
    if (nonLand.length === 0) return 0;
    return nonLand.reduce((s, c) => s + (c.cmc ?? 0), 0) / nonLand.length;
  }, [allCards]);
  const manaCurve = useMemo(() => {
    const out: Record<number, number> = {};
    for (const c of allCards) {
      if ((c.type_line || '').toLowerCase().includes('land')) continue;
      const cmc = Math.min(7, Math.round(c.cmc ?? 0));
      out[cmc] = (out[cmc] ?? 0) + 1;
    }
    return out;
  }, [allCards]);

  const exportText = useMemo(
    () => buildExport(commander, partnerCommander, cards),
    [commander, partnerCommander, cards]
  );
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
    } catch {
      /* ignore */
    }
  };

  // ── Card preview wiring ──────────────────────────────────────────────
  const flat = useMemo(() => {
    const enrichedCards: EnrichedCard[] = [];
    const labels: string[] = [];
    const indexByName = new Map<string, number>();
    for (const g of visibleGroups) {
      for (const row of g.rows) {
        indexByName.set(row.name, enrichedCards.length);
        enrichedCards.push(scryfallToEnriched(row.card));
        labels.push(g.title);
      }
    }
    return { cards: enrichedCards, labels, indexByName };
  }, [visibleGroups]);

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const openPreview = (rowName: string) => {
    const i = flat.indexByName.get(rowName);
    if (i !== undefined) setPreviewIndex(i);
  };

  const ctxValue = useMemo(
    () => ({
      openCard: () => {},
      openPages: () => {},
      isPreviewOpen: previewIndex !== null,
    }),
    [previewIndex]
  );

  return (
    <CardPreviewContext.Provider value={ctxValue}>
      <div className="deck-display">
        <DeckToolbar
          title={title}
          totalCards={totalCards}
          averageCmc={averageCmc}
          totalPrice={totalPrice}
          deckGrade={deckGrade}
          currency={currency}
          sort={sort}
          onSort={setSort}
          search={search}
          onSearch={setSearch}
          onCopy={handleCopy}
        />

        <div className="deck-display-body">
          <div className="deck-card-list">
            {visibleGroups.map((g) => (
              <CategorySection
                key={g.title}
                title={g.title}
                iconClass={g.icon}
                rows={g.rows}
                currency={currency}
                onRowClick={openPreview}
                onRemoveCard={onRemoveCard}
              />
            ))}
          </div>

          <aside className="deck-display-sidebar">
            <DeckStatistics
              allCards={allCards}
              manaCurve={manaCurve}
              bracketEstimation={bracketEstimation}
              roleCounts={roleCounts}
              rampSubtypeCounts={rampSubtypeCounts}
              removalSubtypeCounts={removalSubtypeCounts}
              boardwipeSubtypeCounts={boardwipeSubtypeCounts}
              cardDrawSubtypeCounts={cardDrawSubtypeCounts}
              averageCmc={averageCmc}
              open={statsOpen}
              onToggle={() => setStatsOpen((v) => !v)}
            />
          </aside>
        </div>

        {previewIndex !== null && (
          <CardPreview
            cards={flat.cards}
            sectionLabels={flat.labels}
            pageNumbers={flat.cards.map(() => 0)}
            totalPages={1}
            binderName={title}
            index={previewIndex}
            onIndexChange={setPreviewIndex}
            onClose={() => setPreviewIndex(null)}
          />
        )}
      </div>
    </CardPreviewContext.Provider>
  );
}

// ── ScryfallCard → EnrichedCard adapter for the preview carousel ─────────
function scryfallToEnriched(card: ScryfallCard): EnrichedCard {
  const front = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
  const back =
    card.card_faces && card.card_faces.length > 1
      ? card.card_faces[1].image_uris?.normal
      : undefined;
  return {
    name: card.name,
    setCode: card.set,
    setName: card.set_name,
    collectorNumber: '',
    rarity: card.rarity,
    scryfallId: card.id,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'deck-builder',
    foil: false,
    cmc: card.cmc,
    typeLine: card.type_line,
    colorIdentity: card.color_identity,
    colors: card.colors,
    imageNormal: front,
    imageNormalBack: back,
    layout: card.layout,
    manaCost: card.mana_cost,
    oracleText: card.oracle_text,
  };
}

// ── Toolbar ───────────────────────────────────────────────────────────────
interface ToolbarProps {
  title: string;
  totalCards: number;
  averageCmc: number;
  totalPrice: number;
  deckGrade?: { letter: string; headline: string };
  currency: CurrencyCode;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  search: string;
  onSearch: (s: string) => void;
  onCopy: () => void;
}

function DeckToolbar({
  title,
  totalCards,
  averageCmc,
  totalPrice,
  deckGrade,
  currency,
  sort,
  onSort,
  search,
  onSearch,
  onCopy,
}: ToolbarProps) {
  return (
    <header className="deck-toolbar">
      <div className="deck-toolbar-summary">
        <span className="deck-toolbar-title">{title}</span>
        <span className="deck-toolbar-meta">
          {totalCards} cards · avg CMC {averageCmc.toFixed(2)} · {fmtMoney(totalPrice, currency)}
          {deckGrade ? ` · grade ${deckGrade.letter}` : ''}
        </span>
      </div>
      <div className="deck-toolbar-controls">
        <label className="deck-builder-field">
          <span>Sort</span>
          <select value={sort} onChange={(e) => onSort(e.target.value as SortMode)}>
            <option value="cmc">CMC</option>
            <option value="name">Name</option>
            <option value="color">Color</option>
            <option value="price">Price</option>
          </select>
        </label>
        <input
          type="search"
          className="deck-toolbar-search"
          placeholder="Search…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <button type="button" className="btn btn-primary" onClick={onCopy}>
          Copy decklist
        </button>
      </div>
    </header>
  );
}

// ── Category section ──────────────────────────────────────────────────────
function CategorySection({
  title,
  iconClass,
  rows,
  currency,
  onRowClick,
  onRemoveCard,
}: {
  title: string;
  iconClass: string;
  rows: Row[];
  currency: CurrencyCode;
  onRowClick: (name: string) => void;
  onRemoveCard?: (slotId: string) => void;
}) {
  if (rows.length === 0) return null;
  const subtotal = rows.reduce((sum, r) => sum + r.price, 0);
  const count = rows.reduce((sum, r) => sum + r.qty, 0);
  return (
    <section className="deck-section">
      <header className="deck-section-header">
        <span className="deck-section-icon">
          <i className={`ms ${iconClass}`} aria-hidden />
        </span>
        <h3 className="deck-section-title">
          {title} <span className="deck-section-count">({count})</span>
        </h3>
        <span className="deck-section-subtotal">{fmtMoney(subtotal, currency)}</span>
      </header>
      <ul className="deck-section-rows">
        {rows.map((row) => (
          <DeckCardRow
            key={row.name}
            row={row}
            currency={currency}
            onClick={() => onRowClick(row.name)}
            onRemoveCard={onRemoveCard}
          />
        ))}
      </ul>
    </section>
  );
}

const HAS_HOVER = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

function DeckCardRow({
  row,
  currency,
  onClick,
  onRemoveCard,
}: {
  row: Row;
  currency: CurrencyCode;
  onClick: () => void;
  onRemoveCard?: (slotId: string) => void;
}) {
  const rarity = rarityShort(row.card.rarity);
  const mana = frontFaceMana(row.card);
  const liRef = useRef<HTMLLIElement>(null);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const showTimer = useRef<number | null>(null);
  const imgUrl = row.card.image_uris?.normal ?? row.card.card_faces?.[0]?.image_uris?.normal;

  const HOVER_DELAY_MS = 350;
  const handleEnter = () => {
    if (!HAS_HOVER) return;
    if (showTimer.current) window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => setHover(true), HOVER_DELAY_MS);
  };
  const handleLeave = () => {
    if (!HAS_HOVER) return;
    if (showTimer.current) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setHover(false);
  };

  useEffect(() => {
    return () => {
      if (showTimer.current) window.clearTimeout(showTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!hover || !liRef.current) return;
    const rect = liRef.current.getBoundingClientRect();
    const previewW = 200;
    const previewH = 280;
    const margin = 8;
    const roomRight = window.innerWidth - rect.right - margin;
    const roomLeft = rect.left - margin;
    const placeRight = roomRight >= roomLeft;
    let x = placeRight ? rect.right + 12 : rect.left - previewW - 12;
    x = Math.max(margin, Math.min(x, window.innerWidth - previewW - margin));
    let y = rect.top - previewH / 2 + rect.height / 2;
    y = Math.max(margin, Math.min(y, window.innerHeight - previewH - margin));
    setPos({ x, y });
  }, [hover]);

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRemoveCard && row.slotIds.length > 0) {
      // Remove the last-added slot for this name so undo by re-adding feels natural.
      onRemoveCard(row.slotIds[row.slotIds.length - 1]);
    }
  };

  const statusBadge =
    row.status === 'unowned' ? (
      <span className="deck-row-status deck-row-status-unowned" title="Not in your collection">
        not owned
      </span>
    ) : row.status === 'orphan' ? (
      <span
        className="deck-row-status deck-row-status-orphan"
        title="The collection copy this slot was assigned to is no longer present"
      >
        orphan
      </span>
    ) : null;

  return (
    <li
      ref={liRef}
      className={`deck-row deck-row-status-${row.status}`}
      onClick={onClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span className="deck-row-qty">{row.qty}</span>
      <span className={rarity.cls} title={row.card.rarity}>
        {rarity.letter}
      </span>
      <span className="deck-row-name" title={row.card.type_line}>
        {row.name}
      </span>
      {statusBadge}
      {mana && <ManaCost cost={mana} className="deck-row-mana" />}
      <span className="deck-row-price">{fmtMoney(row.price, currency)}</span>
      {onRemoveCard && row.slotIds.length > 0 && (
        <button
          type="button"
          className="deck-row-remove"
          aria-label={`Remove ${row.name}`}
          onClick={handleRemove}
        >
          ×
        </button>
      )}
      {hover && imgUrl && pos && (
        <img
          className="deck-row-hover-img"
          src={imgUrl}
          alt=""
          aria-hidden="true"
          style={{ left: pos.x, top: pos.y }}
        />
      )}
    </li>
  );
}

// ── Statistics panel ──────────────────────────────────────────────────────
function DeckStatistics({
  allCards,
  manaCurve,
  bracketEstimation,
  roleCounts,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
  averageCmc,
  open,
  onToggle,
}: {
  allCards: ScryfallCard[];
  manaCurve: Record<number, number>;
  bracketEstimation?: BracketEstimation;
  roleCounts?: Record<string, number>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  averageCmc: number;
  open: boolean;
  onToggle: () => void;
}) {
  const cmcKeys = Object.keys(manaCurve)
    .map(Number)
    .sort((a, b) => a - b);
  const maxBucket = Math.max(1, ...cmcKeys.map((k) => manaCurve[k]));

  const colorDist = useMemo(() => {
    const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    let total = 0;
    for (const c of allCards) {
      if ((c.type_line || '').toLowerCase().includes('land')) continue;
      const ci = c.color_identity ?? [];
      if (ci.length === 0) {
        counts.C += 1;
        total += 1;
        continue;
      }
      for (const k of ci) {
        counts[k] = (counts[k] ?? 0) + 1;
        total += 1;
      }
    }
    return { counts, total };
  }, [allCards]);

  const manaProduction = useMemo(() => {
    const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    let totalLands = 0;
    for (const c of allCards) {
      if (!(c.type_line || '').toLowerCase().includes('land')) continue;
      totalLands += 1;
      const colors = landProducedColors(c);
      if (colors.length === 0) {
        counts.C += 1;
        continue;
      }
      for (const k of colors) counts[k] = (counts[k] ?? 0) + 1;
    }
    return { counts, totalLands };
  }, [allCards]);

  const typeBreakdown = useMemo(() => {
    const out: Record<TypeGroup, number> = {
      Land: 0,
      Creature: 0,
      Planeswalker: 0,
      Battle: 0,
      Sorcery: 0,
      Instant: 0,
      Artifact: 0,
      Enchantment: 0,
    };
    for (const c of allCards) {
      out[classifyType(c)] += 1;
    }
    return out;
  }, [allCards]);

  const showRoles = roleCounts !== undefined;

  return (
    <section className="deck-stats" data-open={open || undefined}>
      <button type="button" className="deck-stats-header" onClick={onToggle} aria-expanded={open}>
        <span className="deck-stats-title">Statistics</span>
        <span className="deck-stats-meta">{averageCmc.toFixed(2)} avg CMC</span>
        <span className="deck-stats-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      <div className="deck-stats-grid" hidden={!open}>
        <Panel title="Mana curve">
          <div className="deck-curve">
            {cmcKeys.map((cmc) => (
              <div key={cmc} className="deck-curve-col">
                <div
                  className="deck-curve-bar"
                  style={{ height: `${(manaCurve[cmc] / maxBucket) * 100}%` }}
                  title={`${manaCurve[cmc]} card${manaCurve[cmc] === 1 ? '' : 's'} at CMC ${cmc}`}
                />
                <div className="deck-curve-label">{cmc === 7 ? '7+' : cmc}</div>
                <div className="deck-curve-count">{manaCurve[cmc]}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Color distribution">
          <ColorDonut counts={colorDist.counts} total={colorDist.total} />
        </Panel>

        <Panel title="Mana production">
          <ManaProduction counts={manaProduction.counts} total={manaProduction.totalLands} />
        </Panel>

        {showRoles && (
          <Panel title="Roles">
            <RolesPanel
              roleCounts={roleCounts}
              rampSubtypeCounts={rampSubtypeCounts}
              removalSubtypeCounts={removalSubtypeCounts}
              boardwipeSubtypeCounts={boardwipeSubtypeCounts}
              cardDrawSubtypeCounts={cardDrawSubtypeCounts}
            />
          </Panel>
        )}

        <Panel title="Types">
          <ul className="deck-stats-typelist">
            {(Object.keys(typeBreakdown) as TypeGroup[])
              .filter((k) => typeBreakdown[k] > 0)
              .sort((a, b) => typeBreakdown[b] - typeBreakdown[a])
              .map((k) => (
                <li key={k}>
                  <span>{k}</span>
                  <span>{typeBreakdown[k]}</span>
                </li>
              ))}
          </ul>
        </Panel>

        {bracketEstimation && (
          <Panel title="Estimated bracket">
            <div className="deck-stats-bracket">
              <strong>
                Bracket {bracketEstimation.bracket} — {bracketEstimation.label}
              </strong>
              {bracketEstimation.hardFloors.length > 0 && (
                <span className="deck-stats-bracket-note">
                  {bracketEstimation.hardFloors[0].reason}
                </span>
              )}
            </div>
          </Panel>
        )}
      </div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="deck-stats-panel">
      <h4 className="deck-stats-panel-title">{title}</h4>
      {children}
    </div>
  );
}

function ColorDonut({ counts, total }: { counts: Record<string, number>; total: number }) {
  const order = ['W', 'U', 'B', 'R', 'G', 'C'];
  if (total === 0) return <div className="deck-stats-empty">No data</div>;

  const radius = 36;
  const stroke = 14;
  const circ = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="deck-donut">
      <svg viewBox="-50 -50 100 100" width={88} height={88} aria-label="Color distribution">
        <circle r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {order.map((k) => {
          const v = counts[k] ?? 0;
          if (v === 0) return null;
          const len = (v / total) * circ;
          const seg = (
            <circle
              key={k}
              r={radius}
              fill="none"
              stroke={COLOR_INFO[k]?.pip ?? 'var(--accent)'}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90)"
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <ul className="deck-donut-legend">
        {order
          .filter((k) => (counts[k] ?? 0) > 0)
          .map((k) => {
            const v = counts[k];
            const pct = Math.round((v / total) * 100);
            return (
              <li key={k}>
                <span className="deck-donut-swatch" style={{ background: COLOR_INFO[k]?.pip }} />
                <span>{COLOR_INFO[k]?.label ?? k}</span>
                <span className="deck-donut-pct">{pct}%</span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

function ManaProduction({ counts, total }: { counts: Record<string, number>; total: number }) {
  const order = ['W', 'U', 'B', 'R', 'G', 'C'];
  const max = Math.max(1, ...order.map((k) => counts[k] ?? 0));
  if (total === 0) return <div className="deck-stats-empty">No lands</div>;
  return (
    <ul className="deck-mana-prod">
      {order
        .filter((k) => (counts[k] ?? 0) > 0)
        .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
        .map((k) => {
          const v = counts[k];
          const pct = Math.round((v / total) * 100);
          return (
            <li key={k}>
              <div className="deck-mana-prod-row">
                <span
                  className="deck-mana-prod-swatch"
                  style={{ background: COLOR_INFO[k]?.pip }}
                />
                <span className="deck-mana-prod-name">{COLOR_INFO[k]?.label ?? k}</span>
                <span className="deck-mana-prod-meta">
                  {v} {v === 1 ? 'source' : 'sources'} · {pct}%
                </span>
              </div>
              <div className="deck-mana-prod-bar">
                <div
                  className="deck-mana-prod-bar-fill"
                  style={{
                    width: `${(v / max) * 100}%`,
                    background: COLOR_INFO[k]?.pip,
                  }}
                />
              </div>
            </li>
          );
        })}
    </ul>
  );
}

function RolesPanel({
  roleCounts,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
}: {
  roleCounts?: Record<string, number>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
}) {
  const ramp = roleCounts?.ramp ?? 0;
  const removal = roleCounts?.singleRemoval ?? roleCounts?.removal ?? 0;
  const wipes = roleCounts?.boardWipes ?? roleCounts?.boardwipe ?? 0;
  const draw = roleCounts?.cardDraw ?? roleCounts?.cardAdvantage ?? 0;
  const max = Math.max(1, ramp, removal, wipes, draw);

  const subSummary = (counts: Record<string, number> | undefined): string => {
    if (!counts) return '';
    const entries = Object.entries(counts).filter(([, v]) => v > 0);
    return entries.map(([k, v]) => `${v} ${k}`).join(' · ');
  };

  const items = [
    { label: 'Ramp', value: ramp, sub: subSummary(rampSubtypeCounts), color: 'var(--accent)' },
    { label: 'Removal', value: removal, sub: subSummary(removalSubtypeCounts), color: '#d8442a' },
    {
      label: 'Board wipes',
      value: wipes,
      sub: subSummary(boardwipeSubtypeCounts),
      color: '#d4a838',
    },
    { label: 'Card draw', value: draw, sub: subSummary(cardDrawSubtypeCounts), color: '#3a85cc' },
  ];

  return (
    <ul className="deck-roles">
      {items.map((it) => (
        <li key={it.label}>
          <div className="deck-roles-row">
            <span className="deck-roles-name">{it.label}</span>
            <span className="deck-roles-count">{it.value}</span>
          </div>
          <div className="deck-roles-bar">
            <div
              className="deck-roles-bar-fill"
              style={{ width: `${(it.value / max) * 100}%`, background: it.color }}
            />
          </div>
          {it.sub && <div className="deck-roles-sub">{it.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

// ── Export decklist (plaintext) ───────────────────────────────────────────
function buildExport(
  commander: ScryfallCard | null,
  partner: ScryfallCard | null | undefined,
  cards: DeckDisplayCard[]
): string {
  const lines: string[] = [];
  if (commander) lines.push(`1 ${commander.name}`);
  if (partner) lines.push(`1 ${partner.name}`);
  const counts = new Map<string, number>();
  for (const dc of cards) counts.set(dc.card.name, (counts.get(dc.card.name) ?? 0) + 1);
  for (const [name, qty] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`${qty} ${name}`);
  }
  return lines.join('\n');
}
