import type { EnrichedCard, SetMap, SortDir, SortEntry, SortField } from './types.js';
import { COLOR_INFO, getColorKey, getColorPalette } from './colors.js';
import { TYPE_ORDER, getCardType } from './card-types.js';

export interface SortContext {
  setMap?: SetMap;
  /** Count of physical copies sharing each printing key, keyed by `printingKey(card)`. */
  qtyByPrintingKey?: Map<string, number>;
  /** Per-field custom value orderings. Each entry is the canonical-key list in
   *  user-preferred order. Missing fields fall back to the built-in default. */
  valueOrders?: Partial<Record<SortField, string[]>>;
  /** Import timestamp (ms) keyed by importId, for the `dateAdded` sort. The
   *  collection supplies this from its import history; cards without a matching
   *  importId sort as oldest (0). Absent in binder views, where `dateAdded` is
   *  not offered. */
  addedAtByImportId?: Map<string, number>;
}

export const SORT_FIELDS: { value: SortField; label: string; defaultDir: SortDir }[] = [
  { value: 'color', label: 'Color', defaultDir: 'asc' },
  { value: 'name', label: 'Name', defaultDir: 'asc' },
  { value: 'collectorNumber', label: 'Number', defaultDir: 'asc' },
  { value: 'price', label: 'Price', defaultDir: 'desc' },
  { value: 'quantity', label: 'Quantity', defaultDir: 'desc' },
  { value: 'cmc', label: 'Mana value', defaultDir: 'asc' },
  { value: 'setReleaseDate', label: 'Release date', defaultDir: 'desc' },
  { value: 'setName', label: 'Set', defaultDir: 'asc' },
  { value: 'type', label: 'Type', defaultDir: 'asc' },
  { value: 'rarity', label: 'Rarity', defaultDir: 'asc' },
  { value: 'edhrec', label: 'EDHREC rank', defaultDir: 'asc' },
  { value: 'treatment', label: 'Treatment', defaultDir: 'asc' },
  { value: 'finish', label: 'Finish', defaultDir: 'asc' },
];

/**
 * Treatment + finish are categorical sorts whose value-to-rank mapping is
 * configurable per-binder. The defaults below are "special → regular" for
 * treatment and "foil → non-foil → etched" for finish.
 */

export type TreatmentKey = 'showcase' | 'extendedart' | 'borderless' | 'promo' | 'regular';
export type FinishKey = 'foil' | 'nonfoil' | 'etched';

export const TREATMENT_KEYS: TreatmentKey[] = [
  'showcase',
  'extendedart',
  'borderless',
  'promo',
  'regular',
];
export const FINISH_KEYS: FinishKey[] = ['foil', 'nonfoil', 'etched'];

const TREATMENT_LABELS: Record<TreatmentKey, string> = {
  showcase: 'Showcase',
  extendedart: 'Extended art',
  borderless: 'Borderless',
  promo: 'Promo',
  regular: 'Regular',
};
const FINISH_LABELS: Record<FinishKey, string> = {
  foil: 'Foil',
  nonfoil: 'Non-foil',
  etched: 'Etched',
};

export function getTreatmentKey(card: EnrichedCard): TreatmentKey {
  const frame = card.frameEffects ?? [];
  if (frame.includes('showcase')) return 'showcase';
  if (frame.includes('extendedart')) return 'extendedart';
  if (card.borderColor === 'borderless') return 'borderless';
  if ((card.promoTypes?.length ?? 0) > 0) return 'promo';
  return 'regular';
}

export function getFinishKey(card: EnrichedCard): FinishKey {
  const f = card.finish ?? (card.foil ? 'foil' : 'nonfoil');
  return (FINISH_KEYS as string[]).includes(f) ? (f as FinishKey) : 'nonfoil';
}

/** Sort fields whose value ordering can be customized per binder. */
export const CUSTOMIZABLE_VALUE_ORDER_FIELDS: SortField[] = ['treatment', 'finish'];

export function getDefaultValueOrder(field: SortField): string[] {
  if (field === 'treatment') return [...TREATMENT_KEYS];
  if (field === 'finish') return [...FINISH_KEYS];
  return [];
}

export function getValueLabel(field: SortField, key: string): string {
  if (field === 'treatment') return TREATMENT_LABELS[key as TreatmentKey] ?? key;
  if (field === 'finish') return FINISH_LABELS[key as FinishKey] ?? key;
  return key;
}

/**
 * Resolve the effective ordering for a field, merging any user override with
 * the default. Keys in the override appear first in their chosen order;
 * any default keys missing from the override are appended at the end so
 * additions to the default list don't silently disappear from a user's binder.
 */
export function resolveValueOrder(field: SortField, override: string[] | undefined): string[] {
  const defaults = getDefaultValueOrder(field);
  if (!override?.length) return defaults;
  const seen = new Set(override);
  return [...override.filter((k) => defaults.includes(k)), ...defaults.filter((k) => !seen.has(k))];
}

function rankFromOrder(order: string[], key: string): number {
  const i = order.indexOf(key);
  return i === -1 ? order.length : i;
}

export function treatmentRank(card: EnrichedCard, ctx?: SortContext): number {
  const order = resolveValueOrder('treatment', ctx?.valueOrders?.treatment);
  return rankFromOrder(order, getTreatmentKey(card));
}

export function finishRank(card: EnrichedCard, ctx?: SortContext): number {
  const order = resolveValueOrder('finish', ctx?.valueOrders?.finish);
  return rankFromOrder(order, getFinishKey(card));
}

/** Key used to group physical copies of the same printing (scryfallId + finish). */
export function printingKey(card: EnrichedCard): string {
  const finish = card.finish ?? (card.foil ? 'foil' : 'nonfoil');
  return `${card.scryfallId}|${finish}`;
}

/** Build a count of physical copies per printing key. */
export function buildQtyByPrintingKey(cards: EnrichedCard[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) {
    const k = printingKey(c);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export const RARITY_ORDER: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  special: 4,
  bonus: 5,
};

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/**
 * Canonical Magic ordering of multicolor combinations: 2-color guilds in
 * WUBRG-pair order, then 3-color (shards/wedges), 4-color, then 5-color.
 * Matches the order ManaBox / Scryfall use within the multicolor section.
 */
export const CANONICAL_MULTICOLOR: string[] = [
  'WU',
  'WB',
  'WR',
  'WG',
  'UB',
  'UR',
  'UG',
  'BR',
  'BG',
  'RG',
  'WUB',
  'WUR',
  'WUG',
  'WBR',
  'WBG',
  'WRG',
  'UBR',
  'UBG',
  'URG',
  'BRG',
  'WUBR',
  'WUBG',
  'WURG',
  'WBRG',
  'UBRG',
  'WUBRG',
];

/** Card colors normalized into canonical WUBRG order, e.g. ['G','U'] → 'UG'. */
function canonicalComboKey(palette: string[]): string {
  return [...palette].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('');
}

/**
 * Sort rank for the Color field. Mono/colorless/land keep their COLOR_INFO
 * order (W<U<B<R<G<…). Multicolor cards all share COLOR_INFO order 5, so we
 * fan them out within the [5, 6) band — keeping the Multicolor section
 * contiguous (still before Colorless = 6) while ordering it canonically.
 */
export function colorSortRank(card: EnrichedCard): number {
  const key = getColorKey(card);
  if (key !== 'M') return COLOR_INFO[key]?.order ?? 99;
  const idx = CANONICAL_MULTICOLOR.indexOf(canonicalComboKey(getColorPalette(card) ?? []));
  // Unknown/odd combos sort after the known ones but still inside the band.
  const pos = idx === -1 ? CANONICAL_MULTICOLOR.length : idx;
  return 5 + pos / (CANONICAL_MULTICOLOR.length + 1);
}

export function cardSortValue(
  card: EnrichedCard,
  field: SortField,
  ctx?: SortContext
): number | string {
  switch (field) {
    case 'color':
      return colorSortRank(card);
    case 'type': {
      const idx = TYPE_ORDER.indexOf(getCardType(card));
      return idx === -1 ? 99 : idx;
    }
    case 'rarity':
      return RARITY_ORDER[card.rarity.toLowerCase()] ?? 9;
    case 'cmc':
      return card.cmc ?? 999;
    case 'name':
      return card.name.toLowerCase();
    case 'setReleaseDate': {
      const code = (card.setCode || '').toUpperCase();
      const released = ctx?.setMap?.[code]?.releasedAt;
      // Sets without a known release date sort to the end (largest string).
      return released || '￿';
    }
    case 'setName':
      return (card.setName || card.setCode).toLowerCase();
    case 'price':
      return card.purchasePrice;
    case 'edhrec':
      return card.edhrecRank ?? Number.MAX_SAFE_INTEGER;
    case 'collectorNumber': {
      const n = parseInt(card.collectorNumber, 10);
      return isNaN(n) ? 99999 : n;
    }
    case 'quantity':
      return ctx?.qtyByPrintingKey?.get(printingKey(card)) ?? 1;
    case 'treatment':
      return treatmentRank(card, ctx);
    case 'finish':
      return finishRank(card, ctx);
    case 'dateAdded':
      // Whole-import granularity: every card from one import shares its addedAt.
      // Unknown/legacy cards (no importId, or an id not in the map) sort as oldest.
      return ctx?.addedAtByImportId?.get(card.importId ?? '') ?? 0;
    default:
      return 0;
  }
}

export function sortCards(
  cards: EnrichedCard[],
  sorts: SortEntry[],
  ctx?: SortContext
): EnrichedCard[] {
  const active = sorts.filter((s) => s && s.field !== 'none');
  if (active.length === 0) return [...cards];

  return [...cards].sort((a, b) => {
    for (const { field, dir } of active) {
      const va = cardSortValue(a, field, ctx);
      const vb = cardSortValue(b, field, ctx);
      if (va < vb) return dir === 'desc' ? 1 : -1;
      if (va > vb) return dir === 'desc' ? -1 : 1;
    }
    return 0;
  });
}

/** Suggested defaults for newly-created binders. */
export const NEW_BINDER_DEFAULT_SORTS: SortEntry[] = [{ field: 'color', dir: 'asc' }];

/** Maximum number of sort fields a binder can chain. */
export const MAX_SORTS = 3;

/**
 * Fields applied as implicit tie-breakers after the user's explicit sort chain.
 * They run in order and are skipped per-field if already present in the chain.
 */
export const IMPLICIT_TIEBREAKER_FIELDS: SortField[] = ['treatment', 'finish', 'name'];

/**
 * Human-readable resolved order for fields whose direction is non-obvious.
 * Returns null for fields where ascending/descending is self-explanatory
 * (e.g. name, price, cmc). Honors any binder-level value-order override.
 */
export function describeSortOrder(
  field: SortField,
  dir: SortDir,
  valueOrders?: Partial<Record<SortField, string[]>>
): string | null {
  if (!CUSTOMIZABLE_VALUE_ORDER_FIELDS.includes(field)) return null;
  const order = resolveValueOrder(field, valueOrders?.[field]);
  const labels = order.map((k) => getValueLabel(field, k));
  const ordered = dir === 'desc' ? [...labels].reverse() : labels;
  return ordered.join(' → ');
}

/** True when the user has reordered the values for this field away from the default. */
export function isValueOrderCustomized(field: SortField, override: string[] | undefined): boolean {
  if (!override?.length) return false;
  const defaults = getDefaultValueOrder(field);
  if (!defaults.length) return false;
  const resolved = resolveValueOrder(field, override);
  return resolved.length !== defaults.length || resolved.some((k, i) => k !== defaults[i]);
}

/**
 * Filter the effective sort chain down to what's worth displaying in a
 * breadcrumb. Implicit tie-breakers at their default value-order are hidden
 * to keep the label focused on the user's own rules. Explicit sorts (those
 * present in the user's chain) are always shown, even when they happen to
 * match a tie-breaker field.
 */
export function getDisplaySorts(
  effectiveSorts: SortEntry[],
  explicitSorts: SortEntry[],
  valueOrders?: Partial<Record<SortField, string[]>>
): SortEntry[] {
  const explicitFields = new Set(
    explicitSorts.filter((s) => s && s.field !== 'none').map((s) => s.field)
  );
  return effectiveSorts.filter((s) => {
    if (s.field === 'none') return false;
    if (explicitFields.has(s.field)) return true;
    if (s.field === 'name') return false;
    if (s.field === 'treatment' || s.field === 'finish') {
      return isValueOrderCustomized(s.field, valueOrders?.[s.field]);
    }
    return false;
  });
}

/** Returns the implicit tie-breaker entries that would be appended to a chain. */
export function getImplicitTiebreakers(sorts: SortEntry[]): SortEntry[] {
  const active = sorts.filter((s) => s && s.field !== 'none');
  return IMPLICIT_TIEBREAKER_FIELDS.filter((f) => !active.some((s) => s.field === f)).map(
    (field) => ({ field, dir: 'asc' as const })
  );
}

const SORT_LABEL: Record<SortField, string> = SORT_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.label }),
  {} as Record<SortField, string>
);

const SORT_DEFAULT_DIR: Record<SortField, 'asc' | 'desc'> = SORT_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.defaultDir }),
  {} as Record<SortField, 'asc' | 'desc'>
);

export function sortEntryLabel(entry: SortEntry): string {
  const label = SORT_LABEL[entry.field] ?? entry.field;
  const isNonDefault = entry.dir !== (SORT_DEFAULT_DIR[entry.field] ?? 'asc');
  if (!isNonDefault) return label;
  return `${label} ${entry.dir === 'asc' ? '↑' : '↓'}`;
}
