import {
  BarChart3,
  CircleAlert,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  LayoutGrid,
  List as ListIconLucide,
  MoreVertical,
  Search,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import {
  validateDeck as runValidation,
  countFlaggedCards,
  type LegalityIssue,
} from '../../lib/deck-validation';
import type { DeckCard } from '../../store/decks';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { ManaCost } from '../ManaCost';
import { CardPreview } from '../CardPreview';
import { CardPreviewContext } from '../CardPreviewContext';
import { COLOR_INFO } from '../../lib/colors';
import { classifyAllocation, type AllocationStatus } from '../../lib/allocations';
import type { EnrichedCard } from '../../types';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { cardMatchesRole, type RoleKey } from '@/deck-builder/services/tagger/client';
import { ViewModeToggle as SharedViewModeToggle } from '../ViewModeToggle';
import { SelectMenu } from '../SelectMenu';
import { SortDirArrow } from '../SortDirArrow';

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

// ── View mode + show prefs ───────────────────────────────────────────────
// Mirrors the reference EDH builder's Sort | Show | Search | View toolbar:
//  - View mode picks the deck rendering (list / grid of images / plaintext).
//  - Show prefs hide row metadata the user does not want in their face
//    (price, role badges, mana cost).
// All persisted to localStorage so the deck the user opened yesterday looks
// the way they left it.
// Decks intentionally don't expose a "compact" list mode — the deck row
// is already text-only and tight, so a denser variant would be visually
// indistinguishable from the regular list.
export type DeckViewMode = 'list' | 'grid' | 'text';

interface ShowPrefs {
  price: boolean;
  roles: boolean;
  mana: boolean;
}

const VIEW_MODE_STORAGE_KEY = 'mtg-decks-view-mode';
const SHOW_PREFS_STORAGE_KEY = 'mtg-decks-show-prefs';

const DEFAULT_SHOW_PREFS: ShowPrefs = { price: true, roles: true, mana: true };

function readStoredViewMode(): DeckViewMode {
  if (typeof window === 'undefined') return 'list';
  try {
    const v = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (v === 'list' || v === 'grid' || v === 'text') return v;
    // Migrate the dropped 'compact' mode → 'list' for any persisted value.
    if (v === 'compact') return 'list';
  } catch {
    /* ignore */
  }
  return 'list';
}

function readStoredShowPrefs(): ShowPrefs {
  if (typeof window === 'undefined') return DEFAULT_SHOW_PREFS;
  try {
    const raw = window.localStorage.getItem(SHOW_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_SHOW_PREFS;
    const parsed = JSON.parse(raw) as Partial<ShowPrefs>;
    return { ...DEFAULT_SHOW_PREFS, ...parsed };
  } catch {
    return DEFAULT_SHOW_PREFS;
  }
}

// ── Props ─────────────────────────────────────────────────────────────────
export interface DeckDisplayCard {
  /** Persisted slot id; when present, used for remove. Generated decks pre-save can omit this. */
  slotId?: string;
  card: ScryfallCard;
  /** scryfallId of the specific collection copy claimed by this slot, if any. */
  allocatedCopyId?: string | null;
}

export interface DeckDisplayProps {
  title: string;
  /** When set, the card-preview's "In deck" chip is suppressed for this deck. */
  deckId?: string;
  format?: DeckFormat;
  commander: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  commanderAllocatedCopyId?: string | null;
  partnerCommanderAllocatedCopyId?: string | null;
  cards: DeckDisplayCard[];
  sideboard?: DeckDisplayCard[];
  /** Optional grade/bracket — if provided, renders in the stats and toolbar. */
  bracketEstimation?: BracketEstimation;
  deckGrade?: { letter: string; headline: string };
  /** Role counts from the generator (only present on generated decks). */
  roleCounts?: Record<string, number>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  /** Editing callback. When provided, each row gets a remove option in its menu. */
  onRemoveCard?: (slotId: string) => void;
  onRemoveSideboardCard?: (slotId: string) => void;
  onMoveToSideboard?: (slotId: string) => void;
  onMoveToMainboard?: (slotId: string) => void;
  /**
   * Editing callback for click-to-edit qty. When provided, the qty cell
   * becomes a clickable target that swaps to a numeric input on click;
   * committing the value diffs against the current count and adds/removes
   * slots in bulk. Host owns batching (e.g. one undo toast per edit).
   */
  onSetQty?: (card: ScryfallCard, qty: number) => void;
  /** When provided, each row gets an "Edit printing" option in its menu. */
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  /** When provided, eligible rows get a "Make commander" option in their menu. */
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  /** Predicate that gates the "Make commander" menu item per card. */
  canMakeCommander?: (card: ScryfallCard) => boolean;
  /** Lookup of owned cards by scryfallId, for allocation badges + status. */
  collectionByCopyId?: Map<string, EnrichedCard>;
  /**
   * Optional parent-controlled state for the Export dialog. When both
   * are provided, the parent owns the open state — useful for opening
   * Export from outside the toolbar (e.g. a page-level action sheet).
   * When omitted, DeckDisplay manages the dialog internally.
   */
  exportOpen?: boolean;
  onExportOpenChange?: (open: boolean) => void;
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
  /** Number of slots in this row whose allocatedCopyId resolves to a real owned copy. */
  allocatedQty: number;
  /** Number of slots in this row with no allocatedCopyId (deck wants it, collection lacks it). */
  unownedQty: number;
  /** Number of slots in this row whose allocatedCopyId no longer exists in the collection. */
  orphanQty: number;
  /**
   * Front-face image to display for this row. Prefers the user's owned
   * printing (via `allocatedCopyId` → collection EnrichedCard) so the
   * deck mirrors what's actually in the binder, falling back to the
   * deck-stored ScryfallCard's image when the slot isn't allocated.
   */
  imageNormal?: string;
  imageNormalBack?: string;
  foil: boolean;
  finish: EnrichedCard['finish'];
  finishes?: string[];
  promoTypes?: string[];
  frameEffects?: string[];
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
    const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionById);
    const owned = dc.allocatedCopyId ? collectionById?.get(dc.allocatedCopyId) : undefined;
    if (existing) {
      existing.qty += 1;
      existing.price += priceOf(card, currency);
      if (dc.slotId) existing.slotIds.push(dc.slotId);
      if (status === 'allocated') existing.allocatedQty += 1;
      else if (status === 'orphan') existing.orphanQty += 1;
      else existing.unownedQty += 1;
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
        existing.foil = owned.foil;
        existing.finish = owned.finish;
        existing.finishes = owned.finishes;
        existing.promoTypes = owned.promoTypes;
        existing.frameEffects = owned.frameEffects;
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
      allocatedQty: status === 'allocated' ? 1 : 0,
      unownedQty: status === 'unowned' ? 1 : 0,
      orphanQty: status === 'orphan' ? 1 : 0,
      imageNormal: owned?.imageNormal ?? frontFaceImage(card),
      imageNormalBack: owned?.imageNormalBack ?? backFaceImage(card),
      foil: owned?.foil ?? false,
      finish: owned?.finish ?? 'nonfoil',
      finishes: owned?.finishes,
      promoTypes: owned?.promoTypes,
      frameEffects: owned?.frameEffects,
    });
  }
  return [...map.values()];
}

function statusSeverity(s: AllocationStatus): number {
  return s === 'orphan' ? 2 : s === 'unowned' ? 1 : 0;
}

// Plain-language description of how this row's slots map to owned copies.
// Used as the screen-reader label and hover title for the qty pill, so the
// allocation truth is conveyed even when no warning glyph is shown.
function allocationSummary(row: Row): string {
  const missing = row.unownedQty + row.orphanQty;
  if (missing === 0) {
    return row.qty === 1 ? 'From your collection' : `All ${row.qty} copies from your collection`;
  }
  if (row.allocatedQty === 0) {
    return row.orphanQty > 0
      ? 'The collection copy this slot was assigned to is no longer present'
      : 'Not in your collection';
  }
  const orphanNote = row.orphanQty > 0 ? ` (${row.orphanQty} no longer in collection)` : '';
  return `${row.allocatedQty} of ${row.qty} from your collection${orphanNote}`;
}

function allocationAriaLabel(row: Row, opts: { editable: boolean }): string {
  const base = `${row.qty} in deck`;
  const detail = allocationSummary(row);
  const tail = opts.editable ? ' — click to change quantity' : '';
  return `${base} — ${detail}${tail}`;
}

function allocationTitle(row: Row, opts: { editable: boolean }): string {
  const detail = allocationSummary(row);
  if (!opts.editable) return detail;
  return `${detail} — click to change quantity`;
}

// Inline chip rendered next to the card name. Stays out of the way when the
// row is fully allocated; surfaces a precise "M of N owned" count when only
// some slots are bound to a real collection copy. Orphans get their own
// tone so a stale-allocation row is distinguishable from a never-owned one.
function AllocationChip({ row }: { row: Row }) {
  const missing = row.unownedQty + row.orphanQty;
  if (missing === 0) return null;
  const tone = row.orphanQty > 0 ? 'orphan' : 'unowned';
  const label =
    row.allocatedQty === 0
      ? row.orphanQty > 0
        ? 'orphan'
        : 'unowned'
      : `${row.allocatedQty} of ${row.qty} owned`;
  return (
    <span
      className={`deck-row-alloc-chip deck-row-alloc-chip-${tone}`}
      title={allocationSummary(row)}
      aria-label={allocationSummary(row)}
    >
      {label}
    </span>
  );
}

const SORT_DEFAULT_DIR: Record<SortMode, 'asc' | 'desc'> = {
  name: 'asc',
  cmc: 'asc',
  price: 'desc',
  color: 'asc',
};

function sortRows(rows: Row[], mode: SortMode, dir: 'asc' | 'desc'): Row[] {
  const sorted = [...rows];
  const sign = dir === 'asc' ? 1 : -1;
  switch (mode) {
    case 'cmc':
      sorted.sort((a, b) => (a.cmc - b.cmc) * sign || a.name.localeCompare(b.name));
      break;
    case 'price':
      sorted.sort((a, b) => (a.price - b.price) * sign || a.name.localeCompare(b.name));
      break;
    case 'color': {
      const order = (key: string) => COLOR_INFO[key]?.order ?? 99;
      sorted.sort(
        (a, b) => (order(a.colorKey) - order(b.colorKey)) * sign || a.name.localeCompare(b.name)
      );
      break;
    }
    case 'name':
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name) * sign);
  }
  return sorted;
}

// ── Main component ────────────────────────────────────────────────────────
export function DeckDisplay({
  title,
  deckId,
  format = 'commander',
  commander,
  partnerCommander,
  commanderAllocatedCopyId,
  partnerCommanderAllocatedCopyId,
  cards,
  sideboard = [],
  bracketEstimation,
  deckGrade,
  roleCounts,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
  onRemoveCard,
  onRemoveSideboardCard,
  onMoveToSideboard,
  onMoveToMainboard,
  onSetQty,
  onEditCard,
  onMakeCommander,
  canMakeCommander,
  collectionByCopyId,
  exportOpen: exportOpenProp,
  onExportOpenChange,
}: DeckDisplayProps) {
  const formatConfig = DECK_FORMAT_CONFIGS[format];
  const currency: CurrencyCode = 'USD';
  const [sort, setSort] = useState<SortMode>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const onToggleSort = (m: SortMode) => {
    if (m === sort) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(m);
      setSortDir(SORT_DEFAULT_DIR[m]);
    }
  };
  const [search, setSearch] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>(() => readStoredFormat());
  const [viewMode, setViewMode] = useState<DeckViewMode>(() => readStoredViewMode());
  const [showPrefs, setShowPrefs] = useState<ShowPrefs>(() => readStoredShowPrefs());
  const handleExportFormatChange = (f: ExportFormat) => {
    setExportFormat(f);
    try {
      window.localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, f);
    } catch {
      /* ignore */
    }
  };
  const handleViewModeChange = (m: DeckViewMode) => {
    setViewMode(m);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  };
  const handleShowPrefsChange = (next: ShowPrefs) => {
    setShowPrefs(next);
    try {
      window.localStorage.setItem(SHOW_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  // Stats panel open/closed state — persisted to localStorage so the user's
  // preference survives reloads, mirroring the Combos / Test Hand panels.
  // Defaults to closed when no preference is stored: the header summary
  // ("X.XX avg CMC") gives the at-a-glance signal; expanding is opt-in for
  // when the user wants curve / colors / mana / roles detail.
  const [statsOpen, setStatsOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = window.localStorage.getItem('spellcontrol-deck-stats-open');
      return raw === null ? false : raw === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('spellcontrol-deck-stats-open', statsOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [statsOpen]);

  // Commander rows are synthetic so they always render first; their slot
  // ids are blank because remove is not allowed on the commander.
  const commanderRows: Row[] = useMemo(() => {
    const rows: Row[] = [];
    const push = (c: ScryfallCard, allocatedCopyId?: string | null) => {
      const owned = allocatedCopyId ? collectionByCopyId?.get(allocatedCopyId) : undefined;
      const status: AllocationStatus = classifyAllocation(
        allocatedCopyId ?? null,
        collectionByCopyId
      );
      rows.push({
        name: c.name,
        qty: 1,
        card: c,
        cmc: c.cmc ?? 0,
        price: priceOf(c, currency),
        colorKey: colorKeyOf(c),
        slotIds: [],
        status,
        allocatedQty: status === 'allocated' ? 1 : 0,
        unownedQty: status === 'unowned' ? 1 : 0,
        orphanQty: status === 'orphan' ? 1 : 0,
        imageNormal: owned?.imageNormal ?? frontFaceImage(c),
        imageNormalBack: owned?.imageNormalBack ?? backFaceImage(c),
        foil: owned?.foil ?? false,
        finish: owned?.finish ?? 'nonfoil',
        finishes: owned?.finishes,
        promoTypes: owned?.promoTypes,
        frameEffects: owned?.frameEffects,
      });
    };
    if (commander) push(commander, commanderAllocatedCopyId);
    if (partnerCommander) push(partnerCommander, partnerCommanderAllocatedCopyId);
    return rows;
  }, [
    commander,
    partnerCommander,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    collectionByCopyId,
  ]);

  // Non-commander rows grouped by canonical type.
  const groups = useMemo(() => {
    const rows = buildRows(cards, currency, collectionByCopyId);
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
  }, [cards, commanderRows, collectionByCopyId]);

  // Sideboard rows grouped by canonical type.
  const sideboardGroups = useMemo(() => {
    if (sideboard.length === 0) return [];
    const rows = buildRows(sideboard, currency, collectionByCopyId);
    const buckets = new Map<TypeGroup, Row[]>();
    for (const row of rows) {
      const t = classifyType(row.card);
      const bucket = buckets.get(t) ?? [];
      bucket.push(row);
      buckets.set(t, bucket);
    }
    const ordered: { title: string; icon: string; rows: Row[] }[] = [];
    for (const t of DISPLAY_ORDER) {
      const r = buckets.get(t);
      if (r && r.length > 0) ordered.push({ title: t, icon: TYPE_ICON[t], rows: r });
    }
    return ordered;
  }, [sideboard, collectionByCopyId]);

  // Legality issues for the current format.
  const legalityIssues = useMemo(() => {
    const mainDeckCards: DeckCard[] = cards.map((c) => ({
      slotId: c.slotId ?? '',
      card: c.card,
      allocatedCopyId: c.allocatedCopyId ?? null,
    }));
    const sideDeckCards: DeckCard[] = sideboard.map((c) => ({
      slotId: c.slotId ?? '',
      card: c.card,
      allocatedCopyId: c.allocatedCopyId ?? null,
    }));
    return runValidation(mainDeckCards, sideDeckCards, formatConfig, {
      commander,
      partnerCommander: partnerCommander ?? null,
    });
  }, [cards, sideboard, formatConfig, commander, partnerCommander]);

  const legalityBySlot = useMemo(() => {
    const map = new Map<string, LegalityIssue>();
    for (const issue of legalityIssues) {
      // Prefer the more specific issue type if multiple apply to the same slot.
      // Color-identity and not-legal both signal "this card does not belong";
      // copy-limit is a separate flavor. Keep whichever we saw first since the
      // tooltip only has room for one detail line anyway.
      if (!map.has(issue.slotId)) map.set(issue.slotId, issue);
    }
    return map;
  }, [legalityIssues]);

  const flaggedCardCount = useMemo(() => countFlaggedCards(legalityIssues), [legalityIssues]);

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.map((g) => {
      const filtered = q ? g.rows.filter((r) => r.name.toLowerCase().includes(q)) : g.rows;
      return { ...g, rows: sortRows(filtered, sort, sortDir) };
    });
  }, [groups, sort, sortDir, search]);

  const visibleSideboardGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sideboardGroups.map((g) => {
      const filtered = q ? g.rows.filter((r) => r.name.toLowerCase().includes(q)) : g.rows;
      return { ...g, rows: sortRows(filtered, sort, sortDir) };
    });
  }, [sideboardGroups, sort, sortDir, search]);

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
  // Missing summary — cards in the deck that aren't allocated to a collection
  // copy (i.e. status !== 'allocated'). Surfaces buy-list info inline so we
  // don't need a separate banner above the deck.
  const missing = useMemo(() => {
    let count = 0;
    let price = 0;
    for (const dc of cards) {
      const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId);
      if (status === 'allocated') continue;
      count += 1;
      price += priceOf(dc.card, currency);
    }
    return { count, price };
  }, [cards, collectionByCopyId, currency]);
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
    () => buildExport(commander, partnerCommander, cards, exportFormat, sideboard),
    [commander, partnerCommander, cards, exportFormat, sideboard]
  );
  // If the parent passes both props, treat it as a controlled component
  // (their boolean wins). Otherwise fall back to internal state — keeps
  // simple callers ergonomic and avoids any setState-in-effect dance.
  const [internalExportOpen, setInternalExportOpen] = useState(false);
  const isControlled = exportOpenProp !== undefined && onExportOpenChange !== undefined;
  const exportOpen = isControlled ? exportOpenProp : internalExportOpen;
  const setExportOpen = (next: boolean) => {
    if (isControlled) onExportOpenChange(next);
    else setInternalExportOpen(next);
  };
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
    } catch {
      /* ignore */
    }
  };
  const handleDownload = () => {
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'deck';
    a.download = `${safeName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Card preview wiring ──────────────────────────────────────────────
  const flat = useMemo(() => {
    const enrichedCards: EnrichedCard[] = [];
    const labels: string[] = [];
    const indexByName = new Map<string, number>();
    for (const g of visibleGroups) {
      for (const row of g.rows) {
        indexByName.set(row.name, enrichedCards.length);
        enrichedCards.push(
          scryfallToEnriched(row.card, row.imageNormal, row.imageNormalBack, {
            foil: row.foil,
            finish: row.finish,
            finishes: row.finishes,
            promoTypes: row.promoTypes,
            frameEffects: row.frameEffects,
          })
        );
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
          missingCount={missing.count}
          missingPrice={missing.price}
          deckGrade={deckGrade}
          currency={currency}
          sort={sort}
          sortDir={sortDir}
          onToggleSort={onToggleSort}
          search={search}
          onSearch={setSearch}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          showPrefs={showPrefs}
          onShowPrefsChange={handleShowPrefsChange}
          onExport={() => setExportOpen(true)}
        />

        {flaggedCardCount > 0 && (
          <div className="deck-legality-banner">
            <CircleAlert width={16} height={16} strokeWidth={2} aria-hidden />
            {flaggedCardCount} {flaggedCardCount === 1 ? 'card' : 'cards'} flagged in{' '}
            {formatConfig.label}
          </div>
        )}

        <div className="deck-display-body">
          <div className="deck-display-main">
            {viewMode === 'list' && (
              <div className="deck-card-list">
                {visibleGroups.map((g) => (
                  <CategorySection
                    key={g.title}
                    title={g.title}
                    iconClass={g.icon}
                    rows={g.rows}
                    currency={currency}
                    showPrefs={showPrefs}
                    onRowClick={openPreview}
                    onRemoveCard={onRemoveCard}
                    onSetQty={onSetQty}
                    onEditCard={onEditCard}
                    legalityBySlot={legalityBySlot}
                    onMoveToSideboard={
                      formatConfig.sideboardSize > 0 ? onMoveToSideboard : undefined
                    }
                    onMakeCommander={onMakeCommander}
                    canMakeCommander={canMakeCommander}
                  />
                ))}

                {formatConfig.sideboardSize > 0 && (
                  <div className="deck-sideboard-section">
                    <h3 className="deck-sideboard-header">
                      Sideboard ({sideboard.reduce((sum, _) => sum + 1, 0)}/
                      {formatConfig.sideboardSize})
                    </h3>
                    {visibleSideboardGroups.map((g) => (
                      <CategorySection
                        key={`sb-${g.title}`}
                        title={g.title}
                        iconClass={g.icon}
                        rows={g.rows}
                        currency={currency}
                        showPrefs={showPrefs}
                        onRowClick={openPreview}
                        onRemoveCard={onRemoveSideboardCard}
                        onSetQty={undefined}
                        onEditCard={onEditCard}
                        legalityBySlot={legalityBySlot}
                        onMoveToMainboard={onMoveToMainboard}
                        onMakeCommander={onMakeCommander}
                        canMakeCommander={canMakeCommander}
                      />
                    ))}
                    {sideboard.length === 0 && (
                      <p className="deck-sideboard-empty">No sideboard cards yet</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {viewMode === 'grid' && (
              <DeckCardGrid
                groups={visibleGroups}
                onRowClick={openPreview}
                legalityBySlot={legalityBySlot}
              />
            )}
            {viewMode === 'text' && <DeckTextView text={exportText} />}
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
        {exportOpen && (
          <ExportDialog
            text={exportText}
            format={exportFormat}
            onFormatChange={handleExportFormatChange}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onClose={() => setExportOpen(false)}
          />
        )}
      </div>
    </CardPreviewContext.Provider>
  );
}

function ExportDialog({
  text,
  format,
  onFormatChange,
  onCopy,
  onDownload,
  onClose,
}: {
  text: string;
  format: ExportFormat;
  onFormatChange: (f: ExportFormat) => void;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const handleCopyClick = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export deck"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Export deck</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body export-dialog-body">
          <div className="export-dialog-actions">
            <button type="button" className="export-dialog-action" onClick={handleCopyClick}>
              <span className="export-dialog-action-label">{copied ? 'Copied!' : 'Copy'}</span>
            </button>
            <button type="button" className="export-dialog-action" onClick={onDownload}>
              <span className="export-dialog-action-label">Download</span>
            </button>
          </div>
          <div className="export-dialog-format">
            <SelectMenu
              label="Format"
              ariaLabel="Export format"
              value={format}
              onChange={(v) => onFormatChange(v as ExportFormat)}
              options={(Object.keys(EXPORT_FORMAT_LABEL) as ExportFormat[]).map((f) => ({
                value: f,
                label: EXPORT_FORMAT_LABEL[f],
              }))}
            />
          </div>
          <textarea
            className="export-dialog-preview"
            value={text}
            readOnly
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      </div>
    </div>
  );
}

// ── ScryfallCard → EnrichedCard adapter for the preview carousel ─────────
// Deck-builder cards never went through our import flow, so they have no
// "purchase price" from a CSV. We fall back to Scryfall's listed USD price
// so the carousel still shows a meaningful number instead of $0.00.
interface EnrichedOverrides {
  foil?: boolean;
  finish?: EnrichedCard['finish'];
  finishes?: string[];
  promoTypes?: string[];
  frameEffects?: string[];
}

function scryfallToEnriched(
  card: ScryfallCard,
  frontOverride?: string,
  backOverride?: string,
  overrides?: EnrichedOverrides
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
    copyId: crypto.randomUUID(),
    name: card.name,
    setCode: card.set,
    setName: card.set_name,
    collectorNumber: card.collector_number ?? '',
    rarity: card.rarity,
    scryfallId: card.id,
    purchasePrice: Number.isFinite(price) ? price : 0,
    sourceCategory: '',
    sourceFormat: 'deck-builder',
    foil: overrides?.foil ?? false,
    finish: overrides?.finish ?? ('nonfoil' as const),
    finishes: overrides?.finishes,
    promoTypes: overrides?.promoTypes,
    frameEffects: overrides?.frameEffects,
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
  missingCount: number;
  missingPrice: number;
  deckGrade?: { letter: string; headline: string };
  currency: CurrencyCode;
  sort: SortMode;
  sortDir: 'asc' | 'desc';
  onToggleSort: (s: SortMode) => void;
  search: string;
  onSearch: (s: string) => void;
  viewMode: DeckViewMode;
  onViewModeChange: (m: DeckViewMode) => void;
  showPrefs: ShowPrefs;
  onShowPrefsChange: (next: ShowPrefs) => void;
  onExport: () => void;
}

const SORT_LABEL: Record<SortMode, string> = {
  name: 'Name',
  cmc: 'CMC',
  color: 'Color',
  price: 'Price',
};
const SORT_ORDER: SortMode[] = ['name', 'cmc', 'color', 'price'];

const SHOW_PREFS_LABEL: Record<keyof ShowPrefs, string> = {
  price: 'Price',
  roles: 'Roles',
  mana: 'Mana cost',
};

function DeckToolbar({
  title,
  totalCards,
  averageCmc,
  totalPrice,
  missingCount,
  missingPrice,
  deckGrade,
  currency,
  sort,
  sortDir,
  onToggleSort,
  search,
  onSearch,
  viewMode,
  onViewModeChange,
  showPrefs,
  onShowPrefsChange,
  onExport,
}: ToolbarProps) {
  return (
    <header className="deck-toolbar">
      <div className="deck-toolbar-summary">
        <span className="deck-toolbar-title">{title}</span>
        <span className="deck-toolbar-meta">
          {totalCards} cards · avg CMC {averageCmc.toFixed(2)} · {fmtMoney(totalPrice, currency)}
          {deckGrade ? ` · grade ${deckGrade.letter}` : ''}
          {missingCount > 0 && (
            <>
              {' · '}
              <span className="deck-toolbar-missing">
                {missingCount} missing ({fmtMoney(missingPrice, currency)})
              </span>
            </>
          )}
        </span>
      </div>
      <div className="deck-toolbar-controls">
        <SelectMenu
          ariaLabel="Sort"
          value={sort}
          options={SORT_ORDER.map((m) => ({ value: m, label: SORT_LABEL[m] }))}
          onChange={onToggleSort}
          closeOnSelect={false}
          leadingIcon={<SortDirArrow dir={sortDir} />}
          renderItemPrefix={(_opt, active) => (active ? <SortDirArrow dir={sortDir} /> : null)}
        />

        <ToolbarPopover
          label="Show"
          icon={<Eye width={14} height={14} strokeWidth={2} aria-hidden />}
        >
          {() => (
            <ul className="toolbar-popover-list" role="menu" aria-label="Row details">
              {(Object.keys(SHOW_PREFS_LABEL) as (keyof ShowPrefs)[]).map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={showPrefs[k]}
                    className={`toolbar-popover-item${showPrefs[k] ? ' active' : ''}`}
                    onClick={() => onShowPrefsChange({ ...showPrefs, [k]: !showPrefs[k] })}
                  >
                    <span className="toolbar-popover-check" aria-hidden>
                      {showPrefs[k] ? '✓' : ''}
                    </span>
                    {SHOW_PREFS_LABEL[k]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ToolbarPopover>

        <div className="toolbar-search">
          <Search
            className="toolbar-search-icon"
            width={14}
            height={14}
            strokeWidth={2}
            aria-hidden
          />
          <input
            type="search"
            className="toolbar-search-input"
            placeholder="Search…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Search this deck"
          />
        </div>

        <DeckViewModeToggle value={viewMode} onChange={onViewModeChange} />

        <button type="button" className="btn btn-primary deck-toolbar-export" onClick={onExport}>
          Export
        </button>
      </div>
    </header>
  );
}

// ── Toolbar popover (portal-positioned, same mechanism as SelectMenu) ───
type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

function ToolbarPopover({
  label,
  ariaLabel,
  icon,
  children,
}: {
  label?: string;
  ariaLabel?: string;
  icon?: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const triggerRect = buttonRef.current.getBoundingClientRect();
    setPanelPos((p) => {
      if (!p) return p;
      let next = p;
      if (p.top !== undefined && rect.bottom > window.innerHeight) {
        next = { ...next, top: undefined, bottom: window.innerHeight - triggerRect.top + 6 };
      }
      if (next.bottom !== undefined) {
        const upwardTop = triggerRect.top - 6 - rect.height;
        if (upwardTop < 8) {
          next = { ...next, top: 8, bottom: undefined };
        }
      }
      if (rect.left < 8) {
        next = { ...next, right: undefined, left: Math.max(8, triggerRect.left) };
      }
      return next === p ? p : next;
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node) &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      )
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => {
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    let scrollRaf = 0;
    scrollRaf = requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    });
    return () => {
      cancelAnimationFrame(scrollRaf);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const right = Math.max(0, window.innerWidth - rect.right);
      setPanelPos(
        spaceBelow >= 160
          ? { top: rect.bottom + 6, right }
          : { bottom: window.innerHeight - rect.top + 6, right }
      );
    }
    setOpen((v) => !v);
  };

  const panel =
    open &&
    panelPos &&
    createPortal(
      <div
        ref={panelRef}
        className="toolbar-popover-panel toolbar-popover-panel--fixed"
        style={{
          position: 'fixed',
          left: panelPos.left,
          right: panelPos.right,
          top: panelPos.top,
          bottom: panelPos.bottom,
          zIndex: 1200,
        }}
      >
        {children(() => setOpen(false))}
      </div>,
      document.body
    );

  return (
    <div className="toolbar-popover" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`toolbar-pill${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={!label ? ariaLabel : undefined}
        onClick={handleToggle}
      >
        {icon}
        {label && <span className="toolbar-pill-label">{label}</span>}
        <ChevronDown width={12} height={12} strokeWidth={2} aria-hidden />
      </button>
      {panel}
    </div>
  );
}

// ── View mode segmented control ──────────────────────────────────────────
// Thin wrapper around the shared <SharedViewModeToggle /> with deck-specific
// options (grid / list / text). No 'compact' — see the type declaration.
function DeckViewModeToggle({
  value,
  onChange,
}: {
  value: DeckViewMode;
  onChange: (m: DeckViewMode) => void;
}) {
  return (
    <SharedViewModeToggle<DeckViewMode>
      ariaLabel="Deck view mode"
      value={value}
      onChange={onChange}
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
          value: 'text',
          label: 'Text view',
          icon: <FileText width={14} height={14} strokeWidth={2} aria-hidden />,
        },
      ]}
    />
  );
}

// ── Legality badge ──────────────────────────────────────────────────────
// Shared by list and grid view. Theme-colored; caller sets size/position
// via className.
function LegalityBadge({ issue, className }: { issue: LegalityIssue; className: string }) {
  return (
    <span className={className} role="img" aria-label={issue.detail} title={issue.detail}>
      <CircleAlert width="100%" height="100%" strokeWidth={2.2} aria-hidden />
    </span>
  );
}

// ── Grid view ────────────────────────────────────────────────────────────
function DeckCardGrid({
  groups,
  onRowClick,
  legalityBySlot,
}: {
  groups: { title: string; icon: string; rows: Row[] }[];
  onRowClick: (name: string) => void;
  legalityBySlot?: Map<string, LegalityIssue>;
}) {
  return (
    <div className="deck-card-grid-sections">
      {groups.map((g) => {
        if (g.rows.length === 0) return null;
        const count = g.rows.reduce((s, r) => s + r.qty, 0);
        return (
          <section key={g.title} className="deck-grid-section">
            <header className="deck-section-header">
              <span className="deck-section-icon">
                <i className={`ms ${g.icon}`} aria-hidden />
              </span>
              <h3 className="deck-section-title">
                {g.title} <span className="deck-section-count">({count})</span>
              </h3>
            </header>
            <ul className="deck-card-grid">
              {g.rows.map((row) => (
                <li key={row.name} className="deck-card-grid-cell">
                  <button
                    type="button"
                    className="deck-card-grid-tile"
                    onClick={() => onRowClick(row.name)}
                    aria-label={`${row.name} (${row.qty} in deck — ${allocationSummary(row)})`}
                  >
                    {row.imageNormal ? (
                      <img
                        src={row.imageNormal}
                        alt=""
                        className="deck-card-grid-image"
                        loading="lazy"
                      />
                    ) : (
                      <span className="deck-card-grid-fallback">{row.name}</span>
                    )}
                    {row.qty > 1 && <span className="deck-card-grid-qty">×{row.qty}</span>}
                    {row.foil && <span className="deck-card-grid-foil">foil</span>}
                    {row.status !== 'allocated' &&
                      (row.allocatedQty > 0 ? (
                        <span
                          className={`deck-card-grid-alloc deck-card-grid-alloc-${
                            row.orphanQty > 0 ? 'orphan' : 'unowned'
                          }`}
                          title={allocationSummary(row)}
                          aria-label={allocationSummary(row)}
                        >
                          {row.allocatedQty}/{row.qty}
                        </span>
                      ) : (
                        <span
                          className="deck-card-grid-missing"
                          title={allocationSummary(row)}
                          aria-label={allocationSummary(row)}
                        />
                      ))}
                    {(() => {
                      const issue = legalityBySlot?.get(row.slotIds[0]);
                      return issue ? (
                        <LegalityBadge issue={issue} className="deck-card-grid-illegal" />
                      ) : null;
                    })()}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ── Text view ────────────────────────────────────────────────────────────
function DeckTextView({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="deck-text-view">
      <div className="deck-text-view-header">
        <span className="deck-text-view-hint">Deck list — copy to share or import elsewhere.</span>
        <button type="button" className="btn" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        className="deck-text-view-pre"
        tabIndex={0}
        onFocus={(e) => {
          // Convenience: focusing the block selects all so Cmd/Ctrl+C just works.
          const range = document.createRange();
          range.selectNodeContents(e.currentTarget);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }}
      >
        {text}
      </pre>
    </div>
  );
}

// ── Category section ──────────────────────────────────────────────────────
function CategorySection({
  title,
  iconClass,
  rows,
  currency,
  showPrefs,
  onRowClick,
  onRemoveCard,
  onSetQty,
  onEditCard,
  legalityBySlot,
  onMoveToSideboard,
  onMoveToMainboard,
  onMakeCommander,
  canMakeCommander,
}: {
  title: string;
  iconClass: string;
  rows: Row[];
  currency: CurrencyCode;
  showPrefs: ShowPrefs;
  onRowClick: (name: string) => void;
  onRemoveCard?: (slotId: string) => void;
  onSetQty?: (card: ScryfallCard, qty: number) => void;
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  legalityBySlot?: Map<string, LegalityIssue>;
  onMoveToSideboard?: (slotId: string) => void;
  onMoveToMainboard?: (slotId: string) => void;
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  canMakeCommander?: (card: ScryfallCard) => boolean;
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
        {showPrefs.price && (
          <span className="deck-section-subtotal">{fmtMoney(subtotal, currency)}</span>
        )}
      </header>
      <ul className="deck-section-rows">
        {rows.map((row) => (
          <DeckCardRow
            key={row.name}
            row={row}
            currency={currency}
            showPrefs={showPrefs}
            onClick={() => onRowClick(row.name)}
            onRemoveCard={onRemoveCard}
            onSetQty={onSetQty}
            onEditCard={onEditCard}
            legalityIssue={legalityBySlot?.get(row.slotIds[0])}
            onMoveToZone={onMoveToSideboard ?? onMoveToMainboard}
            moveLabel={
              onMoveToSideboard
                ? 'Move to sideboard'
                : onMoveToMainboard
                  ? 'Move to mainboard'
                  : undefined
            }
            onMakeCommander={onMakeCommander}
            canMakeCommander={canMakeCommander}
          />
        ))}
      </ul>
    </section>
  );
}

function DeckCardRow({
  row,
  currency,
  showPrefs,
  onClick,
  onRemoveCard,
  onSetQty,
  onEditCard,
  legalityIssue,
  onMoveToZone,
  moveLabel,
  onMakeCommander,
  canMakeCommander,
}: {
  row: Row;
  currency: CurrencyCode;
  showPrefs: ShowPrefs;
  onClick: () => void;
  onRemoveCard?: (slotId: string) => void;
  onSetQty?: (card: ScryfallCard, qty: number) => void;
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  legalityIssue?: LegalityIssue;
  onMoveToZone?: (slotId: string) => void;
  moveLabel?: string;
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  canMakeCommander?: (card: ScryfallCard) => boolean;
}) {
  const roleBadge = showPrefs.roles ? getRoleBadge(row.card) : null;
  const mana = showPrefs.mana ? frontFaceMana(row.card) : undefined;
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
  const canEditQty = !!onSetQty && row.slotIds.length > 0;
  const [editingQty, setEditingQty] = useState(false);

  const handleRemoveOne = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (canRemove) onRemoveCard!(row.slotIds[row.slotIds.length - 1]);
  };
  const handleRemoveAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    // Prefer the bulk path so the host can show one undo toast for the whole batch.
    if (canEditQty) onSetQty!(row.card, 0);
    else if (canRemove) {
      for (const slotId of [...row.slotIds].reverse()) onRemoveCard!(slotId);
    }
  };
  const startEditQty = (e: React.MouseEvent) => {
    if (!canEditQty) return;
    e.stopPropagation();
    setEditingQty(true);
  };
  const commitQty = (raw: string) => {
    setEditingQty(false);
    if (!canEditQty) return;
    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(99, parsed));
    if (clamped !== row.qty) onSetQty!(row.card, clamped);
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
      {canEditQty && editingQty ? (
        <input
          type="number"
          min={0}
          max={99}
          autoFocus
          defaultValue={row.qty}
          className={`deck-row-qty-input${row.status !== 'allocated' ? ' deck-row-qty-missing' : ''}`}
          aria-label={`Quantity of ${row.name} in deck`}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitQty(e.currentTarget.value);
            if (e.key === 'Escape') setEditingQty(false);
          }}
          onBlur={(e) => commitQty(e.target.value)}
        />
      ) : canEditQty ? (
        <button
          type="button"
          className={`deck-row-qty deck-row-qty-edit${row.status !== 'allocated' ? ' deck-row-qty-missing' : ''}`}
          aria-label={allocationAriaLabel(row, { editable: true })}
          title={allocationTitle(row, { editable: true })}
          onClick={startEditQty}
        >
          {row.qty}
        </button>
      ) : (
        <span
          className={`deck-row-qty${row.status !== 'allocated' ? ' deck-row-qty-missing' : ''}`}
          aria-label={allocationAriaLabel(row, { editable: false })}
          title={allocationTitle(row, { editable: false })}
        >
          {row.qty}
        </span>
      )}
      {showPrefs.roles &&
        (roleBadge ? (
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
        ))}
      <span className="deck-row-name" title={row.card.type_line}>
        {row.name}
        {row.foil && <span className="deck-row-foil">foil</span>}
        {legalityIssue && <LegalityBadge issue={legalityIssue} className="deck-row-illegal" />}
        <AllocationChip row={row} />
      </span>
      {showPrefs.mana &&
        (mana ? (
          <ManaCost cost={mana} className="deck-row-mana" />
        ) : (
          <span className="deck-row-mana" aria-hidden />
        ))}
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
          <MoreVertical
            className="deck-row-menu-icon"
            width={14}
            height={14}
            strokeWidth={2}
            aria-hidden
          />
        </button>
        {menuOpen && (
          <div role="menu" className="deck-row-menu-popover">
            {onEditCard && row.slotIds.length > 0 && (
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onEditCard(row.slotIds[0], row.card);
                }}
              >
                Edit printing
              </button>
            )}
            {canEditQty && (
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onSetQty!(row.card, row.qty + 1);
                }}
              >
                Add another copy
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="deck-row-menu-item"
              disabled={!canRemove}
              onClick={handleRemoveOne}
            >
              {row.qty > 1 ? 'Remove one copy' : 'Remove from deck'}
            </button>
            {row.qty > 1 && (
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                disabled={!canRemove && !canEditQty}
                onClick={handleRemoveAll}
              >
                Remove all {row.qty} copies
              </button>
            )}
            {onMoveToZone && moveLabel && (
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onMoveToZone(row.slotIds[0]);
                }}
              >
                {moveLabel}
              </button>
            )}
            {onMakeCommander && canMakeCommander?.(row.card) && row.slotIds.length > 0 && (
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onMakeCommander(row.slotIds[0], row.card);
                }}
              >
                Make commander
              </button>
            )}
          </div>
        )}
      </div>
      {showPrefs.price && <span className="deck-row-price">{fmtMoney(row.price, currency)}</span>}
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
        <BarChart3 width={16} height={16} aria-hidden />
        <span className="deck-stats-title">Statistics</span>
        <span className="deck-stats-meta">{averageCmc.toFixed(2)} avg CMC</span>
        <span className="deck-stats-caret" aria-hidden>
          {open ? <ChevronUp width={16} height={16} /> : <ChevronDown width={16} height={16} />}
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

function groupAndSort(cards: DeckDisplayCard[]): { card: ScryfallCard; qty: number }[] {
  const grouped = new Map<string, { card: ScryfallCard; qty: number }>();
  for (const dc of cards) {
    const existing = grouped.get(dc.card.name);
    if (existing) {
      existing.qty += 1;
    } else {
      grouped.set(dc.card.name, { card: dc.card, qty: 1 });
    }
  }
  return [...grouped.values()].sort((a, b) => a.card.name.localeCompare(b.card.name));
}

function buildExport(
  commander: ScryfallCard | null,
  partner: ScryfallCard | null | undefined,
  cards: DeckDisplayCard[],
  format: ExportFormat,
  sideboardCards: DeckDisplayCard[] = []
): string {
  const lines: string[] = [];
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

  for (const { card, qty } of groupAndSort(cards)) {
    lines.push(formatLine(card, qty, format));
  }

  if (sideboardCards.length > 0) {
    lines.push('');
    lines.push('Sideboard');
    for (const { card, qty } of groupAndSort(sideboardCards)) {
      lines.push(formatLine(card, qty, format));
    }
  }
  return lines.join('\n');
}
