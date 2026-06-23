import type { BinderFilter, BinderFilterGroup, ChipExpression, EnrichedCard } from './types.js';
import { getColorKey } from './colors.js';
import { isCommanderEligible } from './commanders-core.js';
import { parseTypeLine } from './card-types.js';
import { normalizeForSearch } from './normalize-search.js';
import { getFinishKey } from './sorting.js';

/**
 * Pre-processed filter ready for the per-card matching hot path.
 *
 * Every chip-bearing field compiles down to a `CompiledExpression`
 * regardless of whether it was authored as legacy `NegatableChip[]` or
 * the richer `ChipExpression`. The unified shape means the per-card
 * matcher only has one code path. See `compileChipField`.
 *
 * Materializing a binder runs `cardMatchesFilter` once per (card × binder).
 * For a 10k-card collection × 10 binders × ~5 chip lists per filter, the
 * naive shape rebuilds and lowercases the chip arrays ~500k times. This
 * struct does that work once per filter so the inner loop is just
 * comparisons.
 */
interface CompiledFilter {
  legalities?: CompiledExpression;
  colors?: CompiledExpression;
  rarities?: CompiledExpression;
  typeChips?: CompiledExpression;
  typeTokenChips?: CompiledExpression;
  supertypeChips?: CompiledExpression;
  subtypeChips?: CompiledExpression;
  oracleChips?: CompiledExpression;
  tagChips?: CompiledExpression;
  finishes?: CompiledExpression;
  layouts?: CompiledExpression;
  treatments?: CompiledExpression;
  borderColors?: CompiledExpression;
  setCodesLower?: string[];
  /**
   * Present iff the filter has a `scryfallQuery`. Membership against the
   * snapshot-resolved oracle ids. An empty set (query authored but not yet
   * resolved) is a real constraint that matches nothing — it must not silently
   * behave like "no constraint".
   */
  scryfallOracleIds?: Set<string>;
  nameContainsNormalized?: string;
  manaCostNormalized?: string;
  priceMin?: number;
  priceMax?: number;
  cmcMin?: number;
  cmcMax?: number;
  edhrecRankMax?: number;
  commanderEligible?: boolean;
}

export function compileFilter(filter: BinderFilter): CompiledFilter {
  const out: CompiledFilter = {};
  out.legalities = compileExpression(filter.legalities);
  out.colors = compileExpression(filter.colors);
  out.rarities = compileExpression(filter.rarities);
  out.typeChips = compileExpression(filter.typeChips);
  out.typeTokenChips = compileExpression(filter.typeTokenChips);
  out.supertypeChips = compileExpression(filter.supertypeChips);
  out.subtypeChips = compileExpression(filter.subtypeChips);
  out.oracleChips = compileExpression(filter.oracleChips);
  out.tagChips = compileExpression(filter.oracleTagChips);
  out.finishes = compileExpression(filter.finishes);
  out.layouts = compileExpression(filter.layouts);
  out.treatments = compileExpression(filter.treatments);
  out.borderColors = compileExpression(filter.borderColors);

  if (filter.setCodes && filter.setCodes.length > 0) {
    out.setCodesLower = filter.setCodes.map((s) => s.toLowerCase());
  }

  if (filter.scryfallQuery) {
    out.scryfallOracleIds = new Set(filter.scryfallQuery.oracleIds);
  }

  const nameRaw = filter.nameContains?.trim();
  if (nameRaw) out.nameContainsNormalized = normalizeForSearch(nameRaw);

  const manaTrimmed = filter.manaCost?.trim();
  if (manaTrimmed) out.manaCostNormalized = normalizeMana(manaTrimmed);

  if (filter.priceMin !== undefined) out.priceMin = filter.priceMin;
  if (filter.priceMax !== undefined) out.priceMax = filter.priceMax;
  if (filter.cmcMin !== undefined) out.cmcMin = filter.cmcMin;
  if (filter.cmcMax !== undefined) out.cmcMax = filter.cmcMax;
  if (filter.edhrecRankMax !== undefined) out.edhrecRankMax = filter.edhrecRankMax;
  if (filter.commanderEligible !== undefined) out.commanderEligible = filter.commanderEligible;

  return out;
}

/**
 * Returns true iff the card matches the compiled filter.
 * All filter fields AND together; absent fields impose no constraint.
 */
export function cardMatchesCompiled(card: EnrichedCard, f: CompiledFilter): boolean {
  if (f.legalities && !legalityMatchesExpression(card.legalities, f.legalities)) return false;

  if (f.rarities && !exactMatchesExpression(card.rarity, f.rarities)) return false;

  // Price: purchasePrice <= 0 means no price recorded — exclude from any price-bounded filter,
  // mirroring the collection predicate in CardListTable.tsx.
  if (f.priceMin !== undefined && (card.purchasePrice <= 0 || card.purchasePrice < f.priceMin))
    return false;
  if (f.priceMax !== undefined && (card.purchasePrice <= 0 || card.purchasePrice > f.priceMax))
    return false;

  if (f.colors) {
    const key = getColorKey(card);
    // '?' = unknown color (no Scryfall data). A filter with any IS chip rejects
    // unknown; an IS-NOT-only filter passes since '?' equals nothing.
    const value = key === '?' ? '' : key;
    if (!exactMatchesExpression(value, f.colors)) return false;
  }

  if (f.typeChips && !substringMatchesExpression(card.typeLine, f.typeChips)) return false;
  if (f.supertypeChips || f.subtypeChips || f.typeTokenChips) {
    const parsed = parseTypeLine(card.typeLine);
    if (f.supertypeChips && !setMatchesExpression(parsed.supertypes, f.supertypeChips))
      return false;
    if (f.typeTokenChips && !setMatchesExpression(parsed.types, f.typeTokenChips)) return false;
    if (f.subtypeChips && !substringMatchesExpression(parsed.subtypes.join(' '), f.subtypeChips))
      return false;
  }
  if (f.oracleChips && !substringMatchesExpression(card.oracleText, f.oracleChips)) return false;
  if (f.tagChips && !setMatchesExpression(card.tags, f.tagChips)) return false;

  // CMC: cmc === undefined means unknown — exclude from any cmc-bounded filter,
  // mirroring the collection predicate in CardListTable.tsx.
  if (f.cmcMin !== undefined && (card.cmc === undefined || card.cmc < f.cmcMin)) return false;
  if (f.cmcMax !== undefined && (card.cmc === undefined || card.cmc > f.cmcMax)) return false;

  if (f.manaCostNormalized !== undefined) {
    if (normalizeMana(card.manaCost || '') !== f.manaCostNormalized) return false;
  }

  if (f.nameContainsNormalized !== undefined) {
    if (!normalizeForSearch(card.name).includes(f.nameContainsNormalized)) return false;
  }

  if (f.setCodesLower) {
    const sc = card.setCode.toLowerCase();
    if (!f.setCodesLower.includes(sc)) return false;
  }

  if (f.scryfallOracleIds) {
    if (!card.oracleId || !f.scryfallOracleIds.has(card.oracleId)) return false;
  }

  if (f.finishes) {
    // Test the finish the user *owns* (single value), not the printing's
    // available finishes. `card.finishes` from Scryfall lists every finish
    // a printing comes in — for most modern basics that's both nonfoil and
    // foil, which would make "Finishes IS foil" match every nonfoil basic.
    if (!setMatchesExpression([getFinishKey(card)], f.finishes)) return false;
  }

  if (f.layouts && !exactMatchesExpression(card.layout, f.layouts)) return false;

  if (f.edhrecRankMax !== undefined) {
    if (card.edhrecRank === undefined) return false;
    if (card.edhrecRank > f.edhrecRankMax) return false;
  }

  if (f.treatments && !setMatchesExpression(effectiveTreatments(card), f.treatments)) return false;

  if (f.borderColors && !exactMatchesExpression(card.borderColor, f.borderColors)) return false;

  if (f.commanderEligible !== undefined) {
    if (isCommanderEligible(card) !== f.commanderEligible) return false;
  }

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
 * Legality-specific matcher: each chip names a format, and IS means
 * "card is legal in that format". Within an AND-group, every IS chip
 * must be legal and no IS NOT chip may be legal. Across groups: any
 * group passing means the expression passes (same OR-of-groups
 * semantics as the other expression matchers).
 *
 * Legacy `[IS standard, IS modern]` compiled to two groups (one per
 * positive) which yields "legal in standard OR legal in modern", the
 * historical behavior. Authoring `IS standard AND IS modern` as a new
 * expression yields "legal in both" — what the user actually asked for.
 */
export function legalityMatchesExpression(
  legalities: Record<string, string> | undefined,
  expr: CompiledExpression
): boolean {
  const legs = legalities || {};
  return expr.groups.some((g) => {
    for (const want of g.is) {
      if (legs[want] !== 'legal') return false;
    }
    for (const reject of g.not) {
      if (legs[reject] === 'legal') return false;
    }
    return true;
  });
}

/**
 * Build the effective set of treatments for a card, including the 'fullart' alias
 * (covers both Scryfall's full_art flag and the 'fullart' frame effect).
 */
export function effectiveTreatments(card: EnrichedCard): string[] {
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
  return (
    isExpressionEmpty(filter.legalities) &&
    isExpressionEmpty(filter.colors) &&
    isExpressionEmpty(filter.rarities) &&
    isExpressionEmpty(filter.typeChips) &&
    isExpressionEmpty(filter.typeTokenChips) &&
    isExpressionEmpty(filter.supertypeChips) &&
    isExpressionEmpty(filter.subtypeChips) &&
    isExpressionEmpty(filter.oracleChips) &&
    isExpressionEmpty(filter.oracleTagChips) &&
    isExpressionEmpty(filter.finishes) &&
    isExpressionEmpty(filter.layouts) &&
    isExpressionEmpty(filter.treatments) &&
    isExpressionEmpty(filter.borderColors) &&
    filter.priceMin === undefined &&
    filter.priceMax === undefined &&
    filter.cmcMin === undefined &&
    filter.cmcMax === undefined &&
    !filter.manaCost?.trim() &&
    !filter.nameContains?.trim() &&
    (!filter.setCodes || filter.setCodes.length === 0) &&
    filter.edhrecRankMax === undefined &&
    filter.commanderEligible === undefined &&
    !filter.scryfallQuery?.query.trim()
  );
}

/**
 * ─── ChipExpression evaluator ─────────────────────────────────────────────
 *
 * Compile-once / match-many evaluator for the richer `ChipExpression` shape
 * (chips with explicit AND/OR joiners). AND binds tighter than OR — i.e.
 * `a OR b AND c` reads as `a OR (b AND c)`. We split the flat chip list into
 * AND-groups at every OR joiner, then the expression matches iff any AND-group
 * matches in full.
 *
 * Coexists with the legacy `NegatableChip[]` path (compileChips +
 * substringMatches / exactMatches). Old fields keep the old code path
 * untouched; new fields opt into this richer model.
 */

/** Pre-processed AND-group for the per-card hot path — string work happens once. */
interface CompiledExpressionGroup {
  is: string[];
  not: string[];
}

export interface CompiledExpression {
  groups: CompiledExpressionGroup[];
}

/**
 * True if the expression has no real constraints. Used at field level to skip
 * matching entirely (mirrors the empty-chip-array short-circuit elsewhere).
 */
export function isExpressionEmpty(expr: ChipExpression | undefined): boolean {
  if (!expr) return true;
  return expr.chips.filter((c) => c.value.trim()).length === 0;
}

/**
 * Compile a `ChipExpression` into AND-groups. Returns `undefined` if the
 * expression is empty so callers can fall through with no work.
 *
 * Splits on OR joiners (with AND-tighter precedence). Joiners array is
 * tolerant of malformed input: short → pads with AND, long → ignores extras.
 */
export function compileExpression(
  expr: ChipExpression | undefined
): CompiledExpression | undefined {
  if (!expr || expr.chips.length === 0) return undefined;
  const groups: CompiledExpressionGroup[] = [{ is: [], not: [] }];
  for (let i = 0; i < expr.chips.length; i++) {
    const c = expr.chips[i];
    const v = c.value.trim().toLowerCase();
    if (v) {
      const g = groups[groups.length - 1];
      if (c.negate) g.not.push(v);
      else g.is.push(v);
    }
    // Joiner between this chip and the next. If absent, defaults to AND
    // (same group). OR starts a new group.
    if (i < expr.chips.length - 1) {
      const joiner = expr.joiners[i] ?? 'AND';
      if (joiner === 'OR') groups.push({ is: [], not: [] });
    }
  }
  // Drop empty trailing groups left by all-blank chips.
  const real = groups.filter((g) => g.is.length > 0 || g.not.length > 0);
  if (real.length === 0) return undefined;
  return { groups: real };
}

/**
 * Substring evaluator for free-text haystacks (typeline / oracle text).
 * Within an AND-group, every `is` substring must appear and no `not` substring
 * may appear. Expression matches iff any AND-group matches.
 *
 * Mirrors `substringMatches` for the legacy shape — same per-group semantics,
 * just extended across multiple OR'd groups.
 */
export function substringMatchesExpression(
  haystack: string | undefined,
  expr: CompiledExpression
): boolean {
  const hay = (haystack || '').toLowerCase();
  return expr.groups.some((g) => {
    for (const v of g.is) if (!hay.includes(v)) return false;
    for (const v of g.not) if (hay.includes(v)) return false;
    return true;
  });
}

/**
 * Exact-match evaluator for single-valued controlled-vocabulary fields
 * (rarity, color key, layout, border color). Same group semantics as
 * substring, just on `===` instead of `includes`.
 *
 * Caveat: AND'ing multiple positive `is` values in one group on a
 * single-valued field is unsatisfiable (a card has one rarity, not two),
 * so authors are expected to use OR for those — the evaluator doesn't try
 * to "fix" that.
 */
export function exactMatchesExpression(
  value: string | undefined,
  expr: CompiledExpression
): boolean {
  const v = (value || '').toLowerCase();
  return expr.groups.some((g) => {
    for (const want of g.is) if (want !== v) return false;
    for (const reject of g.not) if (reject === v) return false;
    return true;
  });
}

/**
 * Set-membership evaluator — for fields where the card has a *set* of values
 * (finishes, treatments, etc.). Within a group: every `is` must be present in
 * the card's set, no `not` may be present. Any group matches → expression
 * matches.
 */
export function setMatchesExpression(
  cardSet: Set<string> | string[] | undefined,
  expr: CompiledExpression
): boolean {
  const set =
    cardSet instanceof Set ? cardSet : new Set((cardSet ?? []).map((s) => s.toLowerCase()));
  return expr.groups.some((g) => {
    for (const want of g.is) if (!set.has(want)) return false;
    for (const reject of g.not) if (set.has(reject)) return false;
    return true;
  });
}
