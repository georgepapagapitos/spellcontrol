import type { BinderFilter, BinderFilterGroup, EnrichedCard, NegatableChip } from '../types';
import { getColorKey } from './colors';

/**
 * A chip list split into IS/IS-NOT halves with values pre-trimmed and
 * pre-lowercased so the per-card matcher does no string work itself.
 */
interface CompiledChips {
  is: string[];
  not: string[];
}

/**
 * Pre-processed filter ready for the per-card matching hot path.
 *
 * Materializing a binder runs `cardMatchesFilter` once per (card × binder).
 * For a 10k-card collection × 10 binders × ~5 chip lists per filter, the
 * naive shape rebuilds and lowercases the chip arrays ~500k times. This
 * struct does that work once per filter so the inner loop is just
 * comparisons.
 */
export interface CompiledFilter {
  legalities?: CompiledChips;
  colors?: CompiledChips;
  rarities?: CompiledChips;
  typeChips?: CompiledChips;
  oracleChips?: CompiledChips;
  finishes?: CompiledChips;
  layouts?: CompiledChips;
  treatments?: CompiledChips;
  borderColors?: CompiledChips;
  setCodesLower?: string[];
  nameContainsLower?: string;
  manaCostNormalized?: string;
  priceMin?: number;
  priceMax?: number;
  cmcMin?: number;
  cmcMax?: number;
  edhrecRankMax?: number;
}

function compileChips(chips: NegatableChip[] | undefined): CompiledChips | undefined {
  if (!chips) return undefined;
  const is: string[] = [];
  const not: string[] = [];
  for (const c of chips) {
    const v = c.value.trim().toLowerCase();
    if (!v) continue;
    if (c.negate) not.push(v);
    else is.push(v);
  }
  if (is.length === 0 && not.length === 0) return undefined;
  return { is, not };
}

export function compileFilter(filter: BinderFilter): CompiledFilter {
  const out: CompiledFilter = {};
  out.legalities = compileChips(filter.legalities);
  out.colors = compileChips(filter.colors);
  out.rarities = compileChips(filter.rarities);
  out.typeChips = compileChips(filter.typeChips);
  out.oracleChips = compileChips(filter.oracleChips);
  out.finishes = compileChips(filter.finishes);
  out.layouts = compileChips(filter.layouts);
  out.treatments = compileChips(filter.treatments);
  out.borderColors = compileChips(filter.borderColors);

  if (filter.setCodes && filter.setCodes.length > 0) {
    out.setCodesLower = filter.setCodes.map((s) => s.toLowerCase());
  }

  const name = filter.nameContains?.trim().toLowerCase();
  if (name) out.nameContainsLower = name;

  const manaTrimmed = filter.manaCost?.trim();
  if (manaTrimmed) out.manaCostNormalized = normalizeMana(manaTrimmed);

  if (filter.priceMin !== undefined) out.priceMin = filter.priceMin;
  if (filter.priceMax !== undefined) out.priceMax = filter.priceMax;
  if (filter.cmcMin !== undefined) out.cmcMin = filter.cmcMin;
  if (filter.cmcMax !== undefined) out.cmcMax = filter.cmcMax;
  if (filter.edhrecRankMax !== undefined) out.edhrecRankMax = filter.edhrecRankMax;

  return out;
}

/**
 * Returns true iff the card matches the compiled filter.
 * All filter fields AND together; absent fields impose no constraint.
 */
export function cardMatchesCompiled(card: EnrichedCard, f: CompiledFilter): boolean {
  if (f.legalities && !legalityMatches(card.legalities, f.legalities)) return false;

  if (f.rarities && !exactMatches(card.rarity, f.rarities)) return false;

  if (f.priceMin !== undefined && card.purchasePrice < f.priceMin) return false;
  if (f.priceMax !== undefined && card.purchasePrice > f.priceMax) return false;

  if (f.colors) {
    const key = getColorKey(card);
    // '?' = unknown color (no Scryfall data). A filter with any IS chip rejects
    // unknown; an IS-NOT-only filter passes since '?' equals nothing.
    const value = key === '?' ? '' : key;
    if (!exactMatches(value, f.colors)) return false;
  }

  if (f.typeChips && !substringMatches(card.typeLine, f.typeChips)) return false;
  if (f.oracleChips && !substringMatches(card.oracleText, f.oracleChips)) return false;

  if (f.cmcMin !== undefined && (card.cmc ?? 0) < f.cmcMin) return false;
  if (f.cmcMax !== undefined && (card.cmc ?? 0) > f.cmcMax) return false;

  if (f.manaCostNormalized !== undefined) {
    if (normalizeMana(card.manaCost || '') !== f.manaCostNormalized) return false;
  }

  if (f.nameContainsLower !== undefined) {
    if (!card.name.toLowerCase().includes(f.nameContainsLower)) return false;
  }

  if (f.setCodesLower) {
    const sc = card.setCode.toLowerCase();
    if (!f.setCodesLower.includes(sc)) return false;
  }

  if (f.finishes) {
    // Falls back to legacy `foil` boolean when Scryfall data is absent.
    const available =
      card.finishes && card.finishes.length > 0 ? card.finishes : [card.foil ? 'foil' : 'nonfoil'];
    if (!setMatches(available, f.finishes)) return false;
  }

  if (f.layouts && !exactMatches(card.layout, f.layouts)) return false;

  if (f.edhrecRankMax !== undefined) {
    if (card.edhrecRank === undefined) return false;
    if (card.edhrecRank > f.edhrecRankMax) return false;
  }

  if (f.treatments && !setMatches(effectiveTreatments(card), f.treatments)) return false;

  if (f.borderColors && !exactMatches(card.borderColor, f.borderColors)) return false;

  return true;
}

/**
 * Compile-and-match in one shot. Use this for one-off checks where you
 * don't have a hot loop. For the materialize path, compile once with
 * `compileFilter` and call `cardMatchesCompiled` per card instead.
 */
export function cardMatchesFilter(card: EnrichedCard, filter: BinderFilter): boolean {
  return cardMatchesCompiled(card, compileFilter(filter));
}

/** Compile every group in a binder so the per-card OR check does no string work. */
export function compileFilterGroups(groups: BinderFilterGroup[]): CompiledFilter[] {
  return groups.map((g) => compileFilter(g.filter));
}

/**
 * OR semantics across compiled groups. Empty list (shouldn't happen — binders
 * always have ≥1 group) conservatively matches nothing.
 */
export function cardMatchesAnyGroup(card: EnrichedCard, compiled: CompiledFilter[]): boolean {
  for (let i = 0; i < compiled.length; i++) {
    if (cardMatchesCompiled(card, compiled[i])) return true;
  }
  return false;
}

/**
 * IS / IS NOT chip semantics for a free-text haystack (substring match):
 *   - At least one IS chip must substring-match the haystack (or no IS chips exist).
 *   - No IS NOT chip may substring-match the haystack.
 * Empty/missing haystack: IS chips never match (so any IS chip → fail);
 * IS NOT chips can never match either, so they're trivially satisfied.
 */
function substringMatches(haystack: string | undefined, chips: CompiledChips): boolean {
  const hay = (haystack || '').toLowerCase();
  if (chips.is.length > 0 && !chips.is.some((v) => hay.includes(v))) return false;
  for (const v of chips.not) {
    if (hay.includes(v)) return false;
  }
  return true;
}

/**
 * Exact-match variant — used for controlled-vocabulary single-valued fields
 * (rarity, color key, layout, border color). Comparison is case-insensitive.
 */
function exactMatches(value: string | undefined, chips: CompiledChips): boolean {
  const v = (value || '').toLowerCase();
  if (chips.is.length > 0 && !chips.is.includes(v)) return false;
  if (chips.not.includes(v)) return false;
  return true;
}

/**
 * Set-membership variant — for fields where the card has a SET of values
 * (finishes, treatments). IS = card's set contains the chip; IS NOT = it doesn't.
 */
function setMatches(cardValues: string[], chips: CompiledChips): boolean {
  // Lower-case scan in place; cardValues is small (typically 1-3 items) so we
  // skip building an actual Set.
  const lowered = cardValues.map((v) => v.toLowerCase());
  if (chips.is.length > 0 && !chips.is.some((v) => lowered.includes(v))) return false;
  for (const v of chips.not) {
    if (lowered.includes(v)) return false;
  }
  return true;
}

/**
 * Legality-specific matcher: each chip names a format, and IS means "card is legal in that format".
 * Multiple IS chips therefore AND together (legal in every format named).
 */
function legalityMatches(
  legalities: Record<string, string> | undefined,
  chips: CompiledChips
): boolean {
  const legs = legalities || {};
  for (const v of chips.is) {
    if (legs[v] !== 'legal') return false;
  }
  for (const v of chips.not) {
    if (legs[v] === 'legal') return false;
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

/** True if every group in the list is empty (binder would match every card). */
export function areAllGroupsEmpty(groups: BinderFilterGroup[]): boolean {
  return groups.every((g) => isFilterEmpty(g.filter));
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
