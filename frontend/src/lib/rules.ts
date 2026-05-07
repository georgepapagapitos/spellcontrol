import type { BinderFilter, EnrichedCard, NegatableChip } from '../types';
import { getColorKey } from './colors';

/**
 * Returns true iff the card matches the binder filter.
 *
 * All filter fields AND together; empty fields impose no constraint.
 * An empty filter (no fields set) matches every card.
 */
export function cardMatchesFilter(card: EnrichedCard, filter: BinderFilter): boolean {
  // Legalities — IS = legal in that format; IS NOT = not legal in that format.
  // Multiple IS chips: card must be legal in ALL of them.
  if (filter.legalities && hasActiveChips(filter.legalities)) {
    if (!legalityChipsMatch(card.legalities, filter.legalities)) return false;
  }

  // Rarity — IS / IS NOT exact match (case-insensitive).
  if (filter.rarities && hasActiveChips(filter.rarities)) {
    if (!exactChipsMatch(card.rarity, filter.rarities)) return false;
  }

  // Price range
  if (filter.priceMin !== undefined && card.purchasePrice < filter.priceMin) return false;
  if (filter.priceMax !== undefined && card.purchasePrice > filter.priceMax) return false;

  // Colors — IS / IS NOT against the card's primary color key (W/U/B/R/G/M/C).
  // Lands match too: Forest → G, Wastes → C, dual lands → M.
  if (filter.colors && hasActiveChips(filter.colors)) {
    const key = getColorKey(card);
    // '?' = unknown color (no Scryfall data). A filter with any IS chip rejects unknown;
    // a filter with only IS NOT chips trivially passes since '?' equals nothing.
    const value = key === '?' ? '' : key;
    if (!exactChipsMatch(value, filter.colors)) return false;
  }

  // Type chips — IS / IS NOT substring match on type_line.
  if (filter.typeChips && hasActiveChips(filter.typeChips)) {
    if (!substringChipsMatch(card.typeLine, filter.typeChips)) return false;
  }

  // Oracle text chips — IS / IS NOT substring match.
  if (filter.oracleChips && hasActiveChips(filter.oracleChips)) {
    if (!substringChipsMatch(card.oracleText, filter.oracleChips)) return false;
  }

  // CMC range — if Scryfall didn't enrich, treat as 0.
  if (filter.cmcMin !== undefined && (card.cmc ?? 0) < filter.cmcMin) return false;
  if (filter.cmcMax !== undefined && (card.cmc ?? 0) > filter.cmcMax) return false;

  // Mana cost — exact string match (case-insensitive, whitespace-trimmed).
  if (filter.manaCost && filter.manaCost.trim()) {
    const target = normalizeMana(filter.manaCost);
    const actual = normalizeMana(card.manaCost || '');
    if (target !== actual) return false;
  }

  // Name substring
  if (filter.nameContains && filter.nameContains.trim()) {
    if (!card.name.toLowerCase().includes(filter.nameContains.trim().toLowerCase())) {
      return false;
    }
  }

  // Set codes — exact match, ANY-of (no IS/IS NOT).
  if (filter.setCodes && filter.setCodes.length > 0) {
    const sc = card.setCode.toLowerCase();
    if (!filter.setCodes.some((s) => s.toLowerCase() === sc)) return false;
  }

  // Finishes — operates on the set of finishes the printing offers.
  // Falls back to legacy `foil` boolean when Scryfall data is absent.
  if (filter.finishes && hasActiveChips(filter.finishes)) {
    const available =
      card.finishes && card.finishes.length > 0 ? card.finishes : [card.foil ? 'foil' : 'nonfoil'];
    if (!setChipsMatch(available, filter.finishes)) return false;
  }

  // Layout — exact match on the card's layout.
  if (filter.layouts && hasActiveChips(filter.layouts)) {
    if (!exactChipsMatch(card.layout, filter.layouts)) return false;
  }

  // EDHREC rank threshold
  if (filter.edhrecRankMax !== undefined) {
    if (card.edhrecRank === undefined) return false;
    if (card.edhrecRank > filter.edhrecRankMax) return false;
  }

  // Treatments — set semantics with the 'fullart' special case (matches both the
  // explicit fullArt flag and any 'fullart' frame effect).
  if (filter.treatments && hasActiveChips(filter.treatments)) {
    const available = effectiveTreatments(card);
    if (!setChipsMatch(available, filter.treatments)) return false;
  }

  // Border color — exact match on borderColor.
  if (filter.borderColors && hasActiveChips(filter.borderColors)) {
    if (!exactChipsMatch(card.borderColor, filter.borderColors)) return false;
  }

  return true;
}

function hasActiveChips(chips: NegatableChip[]): boolean {
  return chips.some((c) => c.value.trim().length > 0);
}

/**
 * IS / IS NOT chip semantics for a free-text haystack (substring match):
 *   - At least one IS chip must substring-match the haystack (or no IS chips exist).
 *   - No IS NOT chip may substring-match the haystack.
 * Empty/missing haystack: IS chips never match (so any IS chip → fail);
 * IS NOT chips can never match either, so they're trivially satisfied.
 */
function substringChipsMatch(haystack: string | undefined, chips: NegatableChip[]): boolean {
  const hay = (haystack || '').toLowerCase();
  const isChips = chips.filter((c) => !c.negate && c.value.trim());
  const notChips = chips.filter((c) => c.negate && c.value.trim());

  if (isChips.length > 0) {
    const anyIs = isChips.some((c) => hay.includes(c.value.trim().toLowerCase()));
    if (!anyIs) return false;
  }
  for (const c of notChips) {
    if (hay.includes(c.value.trim().toLowerCase())) return false;
  }
  return true;
}

/**
 * Exact-match variant — used for controlled-vocabulary single-valued fields
 * (rarity, color key, layout, border color). Comparison is case-insensitive.
 */
function exactChipsMatch(value: string | undefined, chips: NegatableChip[]): boolean {
  const v = (value || '').toLowerCase();
  const isChips = chips.filter((c) => !c.negate && c.value.trim());
  const notChips = chips.filter((c) => c.negate && c.value.trim());

  if (isChips.length > 0) {
    const anyIs = isChips.some((c) => c.value.trim().toLowerCase() === v);
    if (!anyIs) return false;
  }
  for (const c of notChips) {
    if (c.value.trim().toLowerCase() === v) return false;
  }
  return true;
}

/**
 * Set-membership variant — for fields where the card has a SET of values
 * (finishes, treatments). IS = card's set contains the chip; IS NOT = it doesn't.
 * Multiple IS chips OR among themselves; multiple IS NOT chips all must miss.
 */
function setChipsMatch(cardValues: string[], chips: NegatableChip[]): boolean {
  const set = new Set(cardValues.map((v) => v.toLowerCase()));
  const isChips = chips.filter((c) => !c.negate && c.value.trim());
  const notChips = chips.filter((c) => c.negate && c.value.trim());

  if (isChips.length > 0) {
    const anyIs = isChips.some((c) => set.has(c.value.trim().toLowerCase()));
    if (!anyIs) return false;
  }
  for (const c of notChips) {
    if (set.has(c.value.trim().toLowerCase())) return false;
  }
  return true;
}

/**
 * Legality-specific matcher: each chip names a format, and IS means "card is legal in that format".
 * Multiple IS chips therefore AND together (legal in every format named).
 */
function legalityChipsMatch(
  legalities: Record<string, string> | undefined,
  chips: NegatableChip[]
): boolean {
  const legs = legalities || {};
  const isChips = chips.filter((c) => !c.negate && c.value.trim());
  const notChips = chips.filter((c) => c.negate && c.value.trim());

  for (const c of isChips) {
    if (legs[c.value.trim().toLowerCase()] !== 'legal') return false;
  }
  for (const c of notChips) {
    if (legs[c.value.trim().toLowerCase()] === 'legal') return false;
  }
  return true;
}

/**
 * Build the effective set of treatments for a card, including the 'fullart' alias
 * (covers both Scryfall's full_art flag and the 'fullart' frame effect).
 */
function effectiveTreatments(card: EnrichedCard): string[] {
  const out = new Set<string>(card.frameEffects || []);
  if (card.fullArt === true) out.add('fullart');
  return Array.from(out);
}

/** Strip all whitespace and lowercase for mana-cost comparison. */
function normalizeMana(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/** True if a filter has no constraints (matches every card). */
export function isFilterEmpty(filter: BinderFilter): boolean {
  const chipFieldEmpty = (chips?: NegatableChip[]) =>
    !chips || chips.filter((c) => c.value.trim()).length === 0;

  return (
    chipFieldEmpty(filter.legalities) &&
    chipFieldEmpty(filter.colors) &&
    chipFieldEmpty(filter.rarities) &&
    chipFieldEmpty(filter.typeChips) &&
    chipFieldEmpty(filter.oracleChips) &&
    chipFieldEmpty(filter.finishes) &&
    chipFieldEmpty(filter.layouts) &&
    chipFieldEmpty(filter.treatments) &&
    chipFieldEmpty(filter.borderColors) &&
    filter.priceMin === undefined &&
    filter.priceMax === undefined &&
    filter.cmcMin === undefined &&
    filter.cmcMax === undefined &&
    !filter.manaCost?.trim() &&
    !filter.nameContains?.trim() &&
    (!filter.setCodes || filter.setCodes.length === 0) &&
    filter.edhrecRankMax === undefined
  );
}
