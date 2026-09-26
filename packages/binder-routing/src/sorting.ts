import type { EnrichedCard, SetMap, SortDir, SortEntry, SortField } from './types.js';
import { COLOR_INFO, getColorKey, getColorPalette } from './colors.js';
import { TYPE_ORDER, getCardType } from './card-types.js';
import { printedName } from './printed-name.js';

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

/**
 * `asc` / `desc` say which way the comparator runs; they say nothing about what
 * the user will SEE. "Ascending release date" is newest-last, "ascending EDHREC
 * rank" is most-popular-first, and "ascending price" is cheapest-first — three
 * different mental models behind one word. Each field therefore carries the
 * concrete phrasing for both directions, so a direction control can be labelled
 * with its effect ("Newest first") instead of its implementation ("desc").
 */
export const SORT_FIELDS: {
  value: SortField;
  label: string;
  defaultDir: SortDir;
  /** [what ascending looks like, what descending looks like] */
  dirLabels: [string, string];
}[] = [
  { value: 'color', label: 'Color', defaultDir: 'asc', dirLabels: ['WUBRG', 'GRBUW'] },
  { value: 'name', label: 'Name', defaultDir: 'asc', dirLabels: ['A → Z', 'Z → A'] },
  {
    value: 'collectorNumber',
    label: 'Number',
    defaultDir: 'asc',
    dirLabels: ['Low → high', 'High → low'],
  },
  { value: 'price', label: 'Price', defaultDir: 'desc', dirLabels: ['Cheapest', 'Priciest'] },
  { value: 'quantity', label: 'Quantity', defaultDir: 'desc', dirLabels: ['Fewest', 'Most'] },
  { value: 'cmc', label: 'Mana value', defaultDir: 'asc', dirLabels: ['Low → high', 'High → low'] },
  {
    value: 'setReleaseDate',
    label: 'Release date',
    defaultDir: 'desc',
    dirLabels: ['Oldest first', 'Newest first'],
  },
  { value: 'setName', label: 'Set', defaultDir: 'asc', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'type', label: 'Type', defaultDir: 'asc', dirLabels: ['A → Z', 'Z → A'] },
  {
    value: 'rarity',
    label: 'Rarity',
    defaultDir: 'asc',
    // RARITY_ORDER ranks mythic 0 → common 3, so ascending is rarest first.
    // These read the other way round until 2026-09-26: "Common first" put
    // mythics first on every surface that sorts through this list.
    dirLabels: ['Mythic first', 'Common first'],
  },
  // Rank 1 is the most-played card, so ascending rank is the popular end.
  {
    value: 'edhrec',
    label: 'EDHREC rank',
    defaultDir: 'asc',
    dirLabels: ['Most played', 'Least played'],
  },
  {
    value: 'treatment',
    label: 'Treatment',
    defaultDir: 'asc',
    dirLabels: ['Listed order', 'Reversed'],
  },
  { value: 'finish', label: 'Finish', defaultDir: 'asc', dirLabels: ['Listed order', 'Reversed'] },
];

/**
 * The two collection-only fields are deliberately absent from SORT_FIELDS —
 * they'd be dead options in the binder sort picker, which has no import
 * history to sort by. They still appear in the collection's own sort menu, so
 * they still need direction wording; it just doesn't belong in the picker's
 * vocabulary list.
 */
const EXTRA_DIR_LABELS: Partial<Record<SortField, [string, string]>> = {
  dateAdded: ['Oldest first', 'Newest first'],
  dateEdited: ['Oldest first', 'Newest first'],
};

/**
 * What this field's cards look like in this direction, e.g. "Newest first".
 * Falls back to the raw direction for a field with no entry (there is none
 * today; the fallback exists so adding a SortField can't crash a label).
 */
export function sortDirectionLabel(field: SortField, dir: SortDir): string {
  const labels = SORT_FIELDS.find((f) => f.value === field)?.dirLabels ?? EXTRA_DIR_LABELS[field];
  if (!labels) return dir === 'asc' ? 'Ascending' : 'Descending';
  return labels[dir === 'asc' ? 0 : 1];
}

/**
 * `sldDrop` was its own sort field until the drop was folded into `setName` /
 * `setReleaseDate` (a Secret Lair's drop IS its set — see `setMeta`). Binders
 * saved with the old field would group into one dead "All cards" section and
 * label their sort pill `undefined`, so rewrite it on read. Returns the same
 * array reference when there is nothing to migrate.
 */
export function normalizeSorts(sorts: SortEntry[]): SortEntry[] {
  const legacy = (s: SortEntry) => (s?.field as string) === 'sldDrop';
  const seen = new Set<string>();
  // A field repeated in a stored chain sorts nothing the second time but still
  // renders ("name › name") — keep the first occurrence only.
  const dup = (s: SortEntry) => s && (seen.has(s.field) || (seen.add(s.field), false));
  if (!sorts.some((s) => legacy(s) || dup(s))) return sorts;
  seen.clear();
  return sorts
    .map((s) => (legacy(s) ? { ...s, field: 'setName' as const } : s))
    .filter((s) => !dup(s));
}

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
  return `${card.scryfallId}|${getFinishKey(card)}`;
}

/**
 * Durable per-(printing, finish) identity key. Matches the frontend's
 * historical `printingFinishKey` byte-for-byte (colon separator, raw stored
 * finish with foil fallback) because persisted BinderDef fields —
 * `lastReviewedSnapshot.keys`, `pinnedKeys`, `manualKeys` — were captured
 * with it. Distinct from `printingKey` above (pipe + coerced finish), which
 * only groups in-memory for sorting and never persists.
 */
export function printingFinishKey(c: {
  scryfallId: string;
  finish?: string;
  foil?: boolean;
}): string {
  return `${c.scryfallId}:${c.finish ?? (c.foil ? 'foil' : 'nonfoil')}`;
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

/**
 * Returned by `cardSortValue` when the card simply has no value for the field —
 * no known release date, no mana value, no EDHREC rank. Distinct from a low
 * value: `sortCards` keeps these LAST in **both** directions, because "newest
 * first" leading with the cards whose date nobody knows is never what was asked
 * for. The section-side twin is `UNKNOWN_ORDER` in sections.ts; the two must
 * agree or a section's header order and its contents disagree.
 */
export const UNKNOWN_VALUE = Symbol('unknown');

/** Scryfall files every Secret Lair under this one flat set. */
const SLD_CODE = 'SLD';

/**
 * The release date that actually describes this printing.
 *
 * `card.releasedAt` — the printing's OWN date, straight off Scryfall — wins
 * whenever we have it, because a set-level date only ever approximates it and
 * is flatly wrong for a rolling container set. Those are not the edge case they
 * look like: `SLD` files 2,755 printings under 2019-12-02, `PLST` (The List)
 * 5,663 under 2020-09-26, `PRM` 3,094, and `SLP` / `SLC` likewise date years of
 * Secret Lair promos from their first day.
 *
 * The fallbacks below cover a card the per-printing lookup hasn't reached yet
 * (it's device-local reference data, like prices and tags — see
 * `EnrichedCard.releasedAt`):
 *
 *   - a Secret Lair falls back to its **drop** date, never to the `SLD` set —
 *     an unmapped drop has *no* date rather than a wrong one, or a handful of
 *     unattributed bonus cards anchor to 2019 and lead a chronological binder;
 *   - anything else falls back to its set's date.
 *
 * Every branch returns `undefined`, never `''`, for "no date". A blank string is
 * a truthy sort value that sorts FIRST ascending while its own section header
 * takes `UNKNOWN_ORDER` and sorts LAST — precisely the header/content
 * disagreement `UNKNOWN_VALUE` exists to prevent. `SetSummary.releasedAt` is
 * `''` (not optional) for a set Scryfall gave no date for, so the trailing `||`
 * is load-bearing rather than defensive.
 */
export function releaseDateOf(card: EnrichedCard, setMap?: SetMap): string | undefined {
  if (card.releasedAt) return card.releasedAt;
  const code = (card.setCode || '').toUpperCase();
  if (code === SLD_CODE) return card.sldDropReleasedAt || undefined;
  return setMap?.[code]?.releasedAt || undefined;
}

/**
 * Set identity for the two set-driven sorts AND their section grouping. A
 * Secret Lair printing reports its *drop* — Scryfall files all ~2,300 of them
 * under one flat `SLD` set, so grouping by the set code alone gives one useless
 * "Secret Lair Drop" bucket while the drop is the thing you actually bought and
 * sleeve together. Numbers MTGJSON doesn't cover keep the flat set name (see
 * EnrichedCard.sldDrop). The `setName` sort value is `label` lowercased, so a
 * section's position and its cards' order can never disagree (a card with no
 * set used to sort as '' — first — while its "Unknown set" header sorted last).
 */
export function setMeta(card: EnrichedCard): { key: string; label: string } {
  if (card.sldDrop) return { key: `sld-${card.sldDrop}`, label: card.sldDrop };
  return {
    key: card.setCode || 'unknown',
    label: card.setName || card.setCode || 'Unknown set',
  };
}

/**
 * Natural-order key for a collector number: every digit run is zero-padded so
 * plain string comparison gives 2 < 10 < 123 < 123a < 123★, and The List's
 * "2XM-114" / "MMA-90" style numbers sort by their set prefix then number
 * instead of `parseInt` reading "2XM-114" as 2 and "MMA-90" as not-a-number.
 * Digits sort before letters in ASCII, so plain numbers still lead.
 */
export function collectorNumberKey(n: string): string {
  const key = n.toLowerCase().replace(/\d+/g, (d) => d.padStart(6, '0'));
  // Plain numbers (with or without a variant suffix) first; anything carrying
  // a set prefix ("2XM-114", "A-123") after them, in its own natural order.
  return /^\d/.test(n) && !n.includes('-') ? key : `~${key}`;
}

export function cardSortValue(
  card: EnrichedCard,
  field: SortField,
  ctx?: SortContext
): number | string | typeof UNKNOWN_VALUE {
  switch (field) {
    case 'color':
      return colorSortRank(card);
    case 'type': {
      const idx = TYPE_ORDER.indexOf(getCardType(card));
      return idx === -1 ? 99 : idx;
    }
    case 'rarity':
      // `|| 'common'` mirrors getSectionMeta so a blank rarity sorts where its
      // section header sits (and a missing one can't crash the whole binder).
      return RARITY_ORDER[(card.rarity || 'common').toLowerCase()] ?? 9;
    case 'cmc':
      return card.cmc ?? UNKNOWN_VALUE;
    case 'name':
      return printedName(card).toLowerCase();
    case 'setReleaseDate':
      return releaseDateOf(card, ctx?.setMap) ?? UNKNOWN_VALUE;
    case 'setName':
      return setMeta(card).label.toLowerCase();
    case 'setGroup':
      return sameDaySetKey(card);
    case 'price':
      return card.purchasePrice;
    case 'edhrec':
      return card.edhrecRank ?? UNKNOWN_VALUE;
    case 'collectorNumber':
      return card.collectorNumber ? collectorNumberKey(card.collectorNumber) : UNKNOWN_VALUE;
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
    case 'dateEdited':
      // Per-copy edit time, set on quick-add/edit. Cards never manually edited
      // (imported, or predating the field) fall back to their import time so the
      // sort stays meaningful for an untouched collection.
      return card.updatedAt ?? ctx?.addedAtByImportId?.get(card.importId ?? '') ?? 0;
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
      // A card with NO value for this field trails, whichever way the field is
      // pointed — reversing the direction must not promote "we don't know" to
      // the top of the list. Two unknowns are equal, so the chain moves on to
      // the next sort field rather than freezing them in input order.
      if (va === UNKNOWN_VALUE || vb === UNKNOWN_VALUE) {
        if (va === vb) continue;
        return va === UNKNOWN_VALUE ? 1 : -1;
      }
      if (va < vb) return dir === 'desc' ? 1 : -1;
      if (va > vb) return dir === 'desc' ? -1 : 1;
    }
    // Full tie: fall back to copyId so the same cards always land in the same
    // order whatever order they arrived in. Array#sort is stable, so without
    // this two copies of one printing swapped places between renders whenever
    // the collection array was rebuilt (IDB hydration vs a fresh pull), which
    // read as pages shuffling under the user.
    return a.copyId < b.copyId ? -1 : a.copyId > b.copyId ? 1 : 0;
  });
}

/** Suggested defaults for newly-created binders. */
export const NEW_BINDER_DEFAULT_SORTS: SortEntry[] = [{ field: 'color', dir: 'asc' }];

/** Maximum number of sort fields a binder can chain. */
export const MAX_SORTS = 3;

/**
 * Fields applied as implicit tie-breakers after the user's explicit sort chain.
 * They run in order and are skipped per-field if already present in the chain.
 * Set + number close the chain so two printings of the same card (Sol Ring
 * SLD #2417 vs #2539) land in one fixed order rather than input order.
 */
export const IMPLICIT_TIEBREAKER_FIELDS: SortField[] = [
  'treatment',
  'finish',
  'name',
  'setName',
  'collectorNumber',
];

/**
 * The user's chain plus the implicit tie-breakers — the order `materializeBinders`
 * actually sorts by. Two rules beyond appending, both for a chain sorted by
 * release date with no Set entry of its own:
 *
 *   - the internal `setGroup` goes **right after** the date, so same-day sets
 *     stay contiguous and A → Z (three 2026-02-16 Fallout drops once
 *     interleaved page by page). It ignores Secret Lair drops: every drop is
 *     one set, SLD;
 *   - **collector number** closes the user's chain, ahead of the generic
 *     tie-breakers, so a day reads in printed order. For Secret Lairs that
 *     number roughly tracks when each drop was made; drop names A → Z put
 *     SLD #1708 ahead of #786.
 *
 * `buildSections` orders same-day headers the same way (set, then lowest number).
 */
export function withImplicitTiebreakers(sorts: SortEntry[]): SortEntry[] {
  const out = [...sorts];
  const has = (f: SortField) => out.some((s) => s?.field === f);
  const dateIdx = out.findIndex((s) => s?.field === 'setReleaseDate');
  if (dateIdx !== -1 && !has('setName')) {
    if (!has('setGroup')) out.splice(dateIdx + 1, 0, { field: 'setGroup', dir: 'asc' });
    if (!has('collectorNumber')) out.push({ field: 'collectorNumber', dir: 'asc' });
  }
  for (const field of IMPLICIT_TIEBREAKER_FIELDS) {
    // `setGroup` already orders by set; a trailing drop-name Set would only
    // repeat "Set" in the editor's tie-breaker hint.
    if (field === 'setName' && has('setGroup')) continue;
    if (!has(field)) out.push({ field, dir: 'asc' });
  }
  return out;
}

/**
 * The set a printing belongs to, ignoring its Secret Lair drop: every drop is
 * one set (SLD), ordered among themselves by collector number. The value of
 * the internal `setGroup` sort field.
 */
export function sameDaySetKey(card: EnrichedCard): string {
  return (card.setName || card.setCode || 'Unknown set').toLowerCase();
}

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
    if (s.field === 'treatment' || s.field === 'finish') {
      return isValueOrderCustomized(s.field, valueOrders?.[s.field]);
    }
    return false;
  });
}

/** The implicit tie-breaker entries `withImplicitTiebreakers` adds to a chain, in effect order. */
export function getImplicitTiebreakers(sorts: SortEntry[]): SortEntry[] {
  return withImplicitTiebreakers(sorts).filter((e) => !sorts.includes(e));
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
  // `setGroup` is internal (not in SORT_FIELDS) but shows in the editor's
  // tie-breaker hint, where it reads as the set it is.
  const label = SORT_LABEL[entry.field] ?? (entry.field === 'setGroup' ? 'Set' : entry.field);
  const isNonDefault = entry.dir !== (SORT_DEFAULT_DIR[entry.field] ?? 'asc');
  if (!isNonDefault) return label;
  return `${label} ${entry.dir === 'asc' ? '↑' : '↓'}`;
}
