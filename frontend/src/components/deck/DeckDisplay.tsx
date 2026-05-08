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
import { cardMatchesRole, type RoleKey } from '@/deck-builder/services/tagger/client';

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

// Two-letter role badge mirroring the reference repo. Distinguishes
// functional subtypes (Mana Producer / Spot Removal / Wheel / etc.) so
// the eye can scan a deck list and see role coverage without reading.
const ROLE_TITLES: Record<RoleKey, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipe',
  cardDraw: 'Card Advantage',
};
function multiRoleTitle(card: ScryfallCard): string {
  const roles: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];
  const matched = roles.filter((r) => cardMatchesRole(card.name, r));
  return matched.map((r) => ROLE_TITLES[r]).join(' + ') || 'Multi-role';
}

type RoleBadge = { label: string; title: string; tone: string };
function getRoleBadge(card: ScryfallCard): RoleBadge | null {
  if (!card.deckRole) return null;
  switch (card.deckRole) {
    case 'ramp':
      switch (card.rampSubtype) {
        case 'mana-producer':
          return { label: 'MP', title: 'Mana Producer', tone: 'mana-producer' };
        case 'mana-rock':
          return { label: 'MR', title: 'Mana Rock', tone: 'mana-rock' };
        case 'cost-reducer':
          return { label: 'CR', title: 'Cost Reducer', tone: 'cost-reducer' };
        default:
          return { label: 'RA', title: 'Ramp', tone: 'ramp' };
      }
    case 'removal':
      switch (card.removalSubtype) {
        case 'counterspell':
          return { label: 'CT', title: 'Counterspell', tone: 'counterspell' };
        case 'bounce':
          return { label: 'BN', title: 'Bounce', tone: 'bounce' };
        case 'spot-removal':
          return { label: 'SR', title: 'Spot Removal', tone: 'spot-removal' };
        default:
          return { label: 'RE', title: 'Removal', tone: 'removal' };
      }
    case 'boardwipe':
      switch (card.boardwipeSubtype) {
        case 'bounce-wipe':
          return { label: 'BW', title: 'Bounce Wipe', tone: 'bounce-wipe' };
        default:
          return { label: 'WI', title: 'Board Wipe', tone: 'boardwipe' };
      }
    case 'cardDraw':
      switch (card.cardDrawSubtype) {
        case 'tutor':
          return { label: 'TU', title: 'Tutor', tone: 'tutor' };
        case 'wheel':
          return { label: 'WH', title: 'Wheel', tone: 'wheel' };
        case 'cantrip':
          return { label: 'CN', title: 'Cantrip', tone: 'cantrip' };
        case 'card-draw':
          return { label: 'DR', title: 'Card Draw', tone: 'card-draw' };
        default:
          return { label: 'CA', title: 'Card Advantage', tone: 'card-advantage' };
      }
    default:
      return null;
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

export type ExportFormat = 'mtga' | 'plain' | 'moxfield';

const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  mtga: 'MTGA',
  plain: 'Plaintext',
  moxfield: 'Moxfield',
};

const EXPORT_FORMAT_STORAGE_KEY = 'mtg-decks-export-format';

function readStoredFormat(): ExportFormat {
  if (typeof window === 'undefined') return 'mtga';
  try {
    const v = window.localStorage.getItem(EXPORT_FORMAT_STORAGE_KEY);
    if (v === 'mtga' || v === 'plain' || v === 'moxfield') return v;
  } catch {
    /* ignore */
  }
  return 'mtga';
}

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
  /** When set, the card-preview's "In deck" chip is suppressed for this deck. */
  deckId?: string;
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
  /**
   * Front-face image to display for this row. Prefers the user's owned
   * printing (via `allocatedScryfallId` → collection EnrichedCard) so the
   * deck mirrors what's actually in the binder, falling back to the
   * deck-stored ScryfallCard's image when the slot isn't allocated.
   */
  imageNormal?: string;
  imageNormalBack?: string;
}

function frontFaceImage(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}

function backFaceImage(card: ScryfallCard): string | undefined {
  if (card.card_faces && card.card_faces.length > 1) {
    return card.card_faces[1].image_uris?.normal;
  }
  return undefined;
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
  // Tracks whether a row's image was sourced from an owned printing — if so,
  // we don't downgrade it to a deck-stored fallback later.
  const ownedImage = new Set<string>();
  for (const dc of cards) {
    const card = dc.card;
    const existing = map.get(card.name);
    const status = classifyAllocation(dc.allocatedScryfallId ?? null, collectionById);
    const owned = dc.allocatedScryfallId ? collectionById?.get(dc.allocatedScryfallId) : undefined;
    if (existing) {
      existing.qty += 1;
      existing.price += priceOf(card, currency);
      if (dc.slotId) existing.slotIds.push(dc.slotId);
      // Severity: orphan > unowned > allocated. Keep the most-noteworthy.
      if (statusSeverity(status) > statusSeverity(existing.status)) {
        existing.status = status;
      }
      // First owned printing for this row wins — later duplicates may be
      // unowned (and therefore have no collection image), but if an earlier
      // copy fell back to the deck-stored image, an owned copy upgrades it.
      if (owned?.imageNormal && !ownedImage.has(card.name)) {
        existing.imageNormal = owned.imageNormal;
        existing.imageNormalBack = owned.imageNormalBack;
        ownedImage.add(card.name);
      }
      continue;
    }
    if (owned?.imageNormal) ownedImage.add(card.name);
    map.set(card.name, {
      name: card.name,
      qty: 1,
      card,
      cmc: card.cmc ?? 0,
      price: priceOf(card, currency),
      colorKey: colorKeyOf(card),
      slotIds: dc.slotId ? [dc.slotId] : [],
      status,
      imageNormal: owned?.imageNormal ?? frontFaceImage(card),
      imageNormalBack: owned?.imageNormalBack ?? backFaceImage(card),
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
  deckId,
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
  const [sort, setSort] = useState<SortMode>('name');
  const [search, setSearch] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>(() => readStoredFormat());
  const handleExportFormatChange = (f: ExportFormat) => {
    setExportFormat(f);
    try {
      window.localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, f);
    } catch {
      /* ignore */
    }
  };
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
      ordered.push({ title: 'Commander', icon: 'ms-commander', rows: commanderRows });
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
  // Per-color split per CMC bucket — multicolor cards contribute one share
  // to each of their colors, mirroring the Color Distribution donut.
  const manaCurveByColor = useMemo(() => {
    const out: Record<number, Record<string, number>> = {};
    for (const c of allCards) {
      if ((c.type_line || '').toLowerCase().includes('land')) continue;
      const cmc = Math.min(7, Math.round(c.cmc ?? 0));
      const ci = c.color_identity ?? [];
      const keys = ci.length === 0 ? ['C'] : ci;
      const bucket = (out[cmc] ??= {});
      for (const k of keys) bucket[k] = (bucket[k] ?? 0) + 1;
    }
    return out;
  }, [allCards]);

  const exportText = useMemo(
    () => buildExport(commander, partnerCommander, cards, exportFormat),
    [commander, partnerCommander, cards, exportFormat]
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
        enrichedCards.push(scryfallToEnriched(row.card, row.imageNormal, row.imageNormalBack));
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
          exportFormat={exportFormat}
          onExportFormatChange={handleExportFormatChange}
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
              manaCurveByColor={manaCurveByColor}
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
            currentDeckId={deckId}
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
// Deck-builder cards never went through our import flow, so they have no
// "purchase price" from a CSV. We fall back to Scryfall's listed USD price
// so the carousel still shows a meaningful number instead of $0.00.
function scryfallToEnriched(
  card: ScryfallCard,
  frontOverride?: string,
  backOverride?: string
): EnrichedCard {
  const front =
    frontOverride ?? card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
  const back =
    backOverride ??
    (card.card_faces && card.card_faces.length > 1
      ? card.card_faces[1].image_uris?.normal
      : undefined);
  const usd = card.prices?.usd ?? card.prices?.usd_foil ?? card.prices?.usd_etched;
  const price = usd ? Number(usd) : NaN;
  return {
    name: card.name,
    setCode: card.set,
    setName: card.set_name,
    collectorNumber: '',
    rarity: card.rarity,
    scryfallId: card.id,
    purchasePrice: Number.isFinite(price) ? price : 0,
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
  exportFormat: ExportFormat;
  onExportFormatChange: (f: ExportFormat) => void;
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
  exportFormat,
  onExportFormatChange,
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
        <span className="deck-toolbar-export">
          <button type="button" className="btn btn-primary deck-toolbar-copy" onClick={onCopy}>
            Copy
          </button>
          <select
            className="deck-toolbar-export-format"
            value={exportFormat}
            onChange={(e) => onExportFormatChange(e.target.value as ExportFormat)}
            aria-label="Export format"
          >
            {(Object.keys(EXPORT_FORMAT_LABEL) as ExportFormat[]).map((f) => (
              <option key={f} value={f}>
                {EXPORT_FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </span>
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
  const roleBadge = getRoleBadge(row.card);
  const mana = frontFaceMana(row.card);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const canRemove = !!onRemoveCard && row.slotIds.length > 0;
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (canRemove) onRemoveCard!(row.slotIds[row.slotIds.length - 1]);
  };

  return (
    <li
      className="deck-row"
      onClick={onClick}
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
      {roleBadge ? (
        row.card.multiRole ? (
          <span
            className="deck-row-role-badge deck-row-role-multi"
            title={multiRoleTitle(row.card)}
            aria-label={multiRoleTitle(row.card)}
          >
            <span className="deck-row-role-multi-dot" aria-hidden />
          </span>
        ) : (
          <span
            className={`deck-row-role-badge deck-row-role-${roleBadge.tone}`}
            title={roleBadge.title}
          >
            {roleBadge.label}
          </span>
        )
      ) : (
        <span className="deck-row-role-badge deck-row-role-empty" aria-hidden />
      )}
      <span className="deck-row-name" title={row.card.type_line}>
        {row.name}
      </span>
      {mana ? (
        <ManaCost cost={mana} className="deck-row-mana" />
      ) : (
        <span className="deck-row-mana" aria-hidden />
      )}
      <div className="deck-row-menu" ref={menuRef}>
        <button
          type="button"
          className="deck-row-menu-trigger"
          aria-label="Card actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-open={menuOpen || undefined}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <svg
            className="deck-row-menu-icon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
        {menuOpen && (
          <div role="menu" className="deck-row-menu-popover">
            <button
              type="button"
              role="menuitem"
              className="deck-row-menu-item"
              disabled={!canRemove}
              onClick={handleRemove}
            >
              Remove from deck
            </button>
          </div>
        )}
      </div>
      <span className="deck-row-price">{fmtMoney(row.price, currency)}</span>
    </li>
  );
}

// ── Statistics panel ──────────────────────────────────────────────────────
function DeckStatistics({
  allCards,
  manaCurve,
  manaCurveByColor,
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
  manaCurveByColor: Record<number, Record<string, number>>;
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
  // Always render the full 0–7+ axis so a near-empty deck (e.g. just a
  // commander) does not produce a single column stretched across the panel.
  const cmcKeys = [0, 1, 2, 3, 4, 5, 6, 7];
  const maxBucket = Math.max(1, ...cmcKeys.map((k) => manaCurve[k] ?? 0));

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
            {cmcKeys.map((cmc) => {
              const count = manaCurve[cmc] ?? 0;
              const byColor = manaCurveByColor[cmc] ?? {};
              const totalShares = Object.values(byColor).reduce((s, n) => s + n, 0);
              const segments = ['W', 'U', 'B', 'R', 'G', 'C']
                .map((k) => ({ k, n: byColor[k] ?? 0 }))
                .filter((s) => s.n > 0);
              return (
                <div key={cmc} className="deck-curve-col">
                  <div
                    className="deck-curve-bar"
                    style={{ height: `${(count / maxBucket) * 100}%` }}
                    title={`${count} card${count === 1 ? '' : 's'} at CMC ${cmc}`}
                  >
                    {segments.map((s) => (
                      <div
                        key={s.k}
                        className="deck-curve-bar-seg"
                        style={{
                          height: `${(s.n / totalShares) * 100}%`,
                          background: COLOR_INFO[s.k]?.pip ?? 'var(--accent)',
                        }}
                      />
                    ))}
                  </div>
                  <div className="deck-curve-label">{cmc === 7 ? '7+' : cmc}</div>
                  <div className="deck-curve-count">{count}</div>
                </div>
              );
            })}
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

// ── Export decklist ───────────────────────────────────────────────────────
function formatLine(card: ScryfallCard, qty: number, format: ExportFormat): string {
  switch (format) {
    case 'mtga': {
      const set = (card.set || '').toUpperCase();
      const num = card.collector_number ?? '';
      if (set && num) return `${qty} ${card.name} (${set}) ${num}`;
      return `${qty} ${card.name}`;
    }
    case 'moxfield': {
      const set = (card.set || '').toUpperCase();
      const num = card.collector_number ?? '';
      if (set && num) return `${qty} ${card.name} (${set}) ${num}`;
      if (set) return `${qty} ${card.name} (${set})`;
      return `${qty} ${card.name}`;
    }
    case 'plain':
    default:
      return `${qty} ${card.name}`;
  }
}

function buildExport(
  commander: ScryfallCard | null,
  partner: ScryfallCard | null | undefined,
  cards: DeckDisplayCard[],
  format: ExportFormat
): string {
  const lines: string[] = [];
  // MTGA decklist convention: commander section first.
  if (format === 'mtga' && (commander || partner)) {
    lines.push('Commander');
    if (commander) lines.push(formatLine(commander, 1, format));
    if (partner) lines.push(formatLine(partner, 1, format));
    lines.push('');
    lines.push('Deck');
  } else {
    if (commander) lines.push(formatLine(commander, 1, format));
    if (partner) lines.push(formatLine(partner, 1, format));
  }

  const grouped = new Map<string, { card: ScryfallCard; qty: number }>();
  for (const dc of cards) {
    const existing = grouped.get(dc.card.name);
    if (existing) {
      existing.qty += 1;
    } else {
      grouped.set(dc.card.name, { card: dc.card, qty: 1 });
    }
  }
  const sorted = [...grouped.values()].sort((a, b) => a.card.name.localeCompare(b.card.name));
  for (const { card, qty } of sorted) {
    lines.push(formatLine(card, qty, format));
  }
  return lines.join('\n');
}
