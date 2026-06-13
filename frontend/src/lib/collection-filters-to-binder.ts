import type { BinderFilter, BinderFilterGroup, ChipExpression } from '../types';
import { isExpressionEmpty } from './rules';

/**
 * Subset of collection filter state that can be mapped to a binder rule group.
 * Mirrors the filter state variables in CardListTable.
 */
export interface CollectionFilterInput {
  colorFilter: Set<string>;
  supertypeExpr: ChipExpression;
  typesExpr: ChipExpression;
  subtypeExpr: ChipExpression;
  rarityExpr: ChipExpression;
  oracleExpr: ChipExpression;
  legalityExpr: ChipExpression;
  layoutExpr: ChipExpression;
  treatmentExpr: ChipExpression;
  borderExpr: ChipExpression;
  finishExpr: ChipExpression;
  conditionExpr: ChipExpression;
  binderExpr: ChipExpression;
  setFilter: Set<string>;
  priceMin: number | undefined;
  priceMax: number | undefined;
  cmcMin: number | undefined;
  cmcMax: number | undefined;
  search: string;
}

/**
 * Returns true when the input has at least one STRUCTURED filter active
 * (i.e. something other than a bare search term). Used to gate the
 * "Save as binder" button.
 */
export function hasStructuredFilter(input: CollectionFilterInput): boolean {
  return (
    input.colorFilter.size > 0 ||
    !isExpressionEmpty(input.supertypeExpr) ||
    !isExpressionEmpty(input.typesExpr) ||
    !isExpressionEmpty(input.subtypeExpr) ||
    !isExpressionEmpty(input.rarityExpr) ||
    !isExpressionEmpty(input.oracleExpr) ||
    !isExpressionEmpty(input.legalityExpr) ||
    !isExpressionEmpty(input.layoutExpr) ||
    !isExpressionEmpty(input.treatmentExpr) ||
    !isExpressionEmpty(input.borderExpr) ||
    !isExpressionEmpty(input.finishExpr) ||
    input.setFilter.size > 0 ||
    input.priceMin !== undefined ||
    input.priceMax !== undefined ||
    input.cmcMin !== undefined ||
    input.cmcMax !== undefined
  );
}

/**
 * Map collection filter state into a binder filter group + a list of
 * flag keys for fields that were dropped or differ in meaning.
 *
 * Flagged keys:
 *   'color'     — color filter carried best-effort (binders use exact color key, collection uses identity-any-of)
 *   'condition' — condition filter dropped (physical-copy only, no binder equivalent)
 *   'binder'    — binder membership filter dropped (circular — a binder can't filter by binder)
 *
 * Price, CMC, and name are now faithfully mapped — not flagged.
 */
export function collectionFiltersToFilterGroup(input: CollectionFilterInput): {
  group: BinderFilterGroup;
  flagged: string[];
} {
  const filter: BinderFilter = {};
  const flagged: string[] = [];

  // Supertype → supertypeChips (exact-token). Clone so the seed doesn't share
  // object identity with the live collection filter state.
  if (!isExpressionEmpty(input.supertypeExpr)) {
    filter.supertypeChips = cloneExpr(input.supertypeExpr);
  }

  // Primary types → typeTokenChips (exact-token via parsed primary types).
  // The collection predicate uses setMatchesExpression(parsed.types, ...) which
  // is exact-token, so we map to typeTokenChips (not typeChips which is substring).
  // Condition/binder filters can't map to a binder — they are NOT mapped here,
  // so the button is suppressed when only those are active.
  if (!isExpressionEmpty(input.typesExpr)) {
    filter.typeTokenChips = cloneExpr(input.typesExpr);
  }

  // Subtype → subtypeChips (substring)
  if (!isExpressionEmpty(input.subtypeExpr)) {
    filter.subtypeChips = cloneExpr(input.subtypeExpr);
  }

  // Rarity
  if (!isExpressionEmpty(input.rarityExpr)) {
    filter.rarities = cloneExpr(input.rarityExpr);
  }

  // Oracle text
  if (!isExpressionEmpty(input.oracleExpr)) {
    filter.oracleChips = cloneExpr(input.oracleExpr);
  }

  // Legalities
  if (!isExpressionEmpty(input.legalityExpr)) {
    filter.legalities = cloneExpr(input.legalityExpr);
  }

  // Layout
  if (!isExpressionEmpty(input.layoutExpr)) {
    filter.layouts = cloneExpr(input.layoutExpr);
  }

  // Treatments
  if (!isExpressionEmpty(input.treatmentExpr)) {
    filter.treatments = cloneExpr(input.treatmentExpr);
  }

  // Border
  if (!isExpressionEmpty(input.borderExpr)) {
    filter.borderColors = cloneExpr(input.borderExpr);
  }

  // Finish
  if (!isExpressionEmpty(input.finishExpr)) {
    filter.finishes = cloneExpr(input.finishExpr);
  }

  // Sets
  if (input.setFilter.size > 0) {
    filter.setCodes = [...input.setFilter].map((s) => s.toUpperCase());
  }

  // Price — faithfully mapped; engine now excludes $0 cards on any price-bounded filter.
  if (input.priceMin !== undefined) filter.priceMin = input.priceMin;
  if (input.priceMax !== undefined) filter.priceMax = input.priceMax;

  // CMC — faithfully mapped; engine now excludes unknown-cmc cards.
  if (input.cmcMin !== undefined) filter.cmcMin = input.cmcMin;
  if (input.cmcMax !== undefined) filter.cmcMax = input.cmcMax;

  // Color — best-effort: map each selected color key to an IS chip, OR-joined.
  // Binders use exact color key (getColorKey); collection uses identity-any-of.
  // Flag it so the editor note tells the user color matching differs.
  if (input.colorFilter.size > 0) {
    const colorChips = [...input.colorFilter].map((k) => ({ value: k, negate: false }));
    const colorJoiners = colorChips.slice(1).map((): 'OR' => 'OR');
    filter.colors = { chips: colorChips, joiners: colorJoiners };
    flagged.push('color');
  }

  // Condition — dropped (physical-copy only, no binder equivalent)
  if (!isExpressionEmpty(input.conditionExpr)) {
    flagged.push('condition');
  }

  // Binder membership — dropped (circular)
  if (!isExpressionEmpty(input.binderExpr)) {
    flagged.push('binder');
  }

  // Search — carried only when structured filters are also present (defensive,
  // since the button is already gated on hasStructuredFilter).
  if (input.search.trim() && hasStructuredFilter(input)) {
    filter.nameContains = input.search.trim();
  }

  return { group: { filter }, flagged };
}

/**
 * Deep-clone a ChipExpression so the binder seed never shares object identity
 * with the live collection filter state.
 */
function cloneExpr(e: ChipExpression): ChipExpression {
  return { chips: e.chips.map((c) => ({ ...c })), joiners: [...e.joiners] };
}

/**
 * Derive a short human-readable name for the would-be binder from the
 * active collection filters. Returns "Filtered binder" when nothing
 * nameable is present. Deterministic (no Date/random).
 */
export function deriveBinderName(input: CollectionFilterInput): string {
  const parts: string[] = [];

  // Rarity abbreviations
  if (!isExpressionEmpty(input.rarityExpr)) {
    const is = input.rarityExpr.chips
      .filter((c) => !c.negate && c.value.trim())
      .map((c) => {
        const v = c.value.trim().toLowerCase();
        if (v === 'common') return 'C';
        if (v === 'uncommon') return 'U';
        if (v === 'rare') return 'R';
        if (v === 'mythic') return 'M';
        return c.value.trim();
      });
    if (is.length > 0) parts.push(is.join('/'));
  }

  // Color filter
  if (input.colorFilter.size > 0) {
    parts.push([...input.colorFilter].sort().join('/'));
  }

  // Supertype abbreviation
  if (!isExpressionEmpty(input.supertypeExpr)) {
    const is = input.supertypeExpr.chips
      .filter((c) => !c.negate && c.value.trim())
      .map((c) => c.value.trim());
    if (is.length > 0) parts.push(is.join(', '));
  }

  // Primary type
  if (!isExpressionEmpty(input.typesExpr)) {
    const is = input.typesExpr.chips
      .filter((c) => !c.negate && c.value.trim())
      .map((c) => c.value.trim());
    if (is.length > 0) parts.push(is.join(', '));
  }

  // Price
  if (input.priceMin !== undefined && input.priceMax !== undefined) {
    parts.push(`$${input.priceMin}–${input.priceMax}`);
  } else if (input.priceMin !== undefined) {
    parts.push(`$${input.priceMin}+`);
  } else if (input.priceMax !== undefined) {
    parts.push(`≤$${input.priceMax}`);
  }

  // CMC
  if (input.cmcMin !== undefined && input.cmcMax !== undefined) {
    parts.push(`CMC ${input.cmcMin}–${input.cmcMax}`);
  } else if (input.cmcMin !== undefined) {
    parts.push(`CMC ${input.cmcMin}+`);
  } else if (input.cmcMax !== undefined) {
    parts.push(`CMC ≤${input.cmcMax}`);
  }

  // Sets
  if (input.setFilter.size > 0 && parts.length < 3) {
    const codes = [...input.setFilter].slice(0, 2);
    parts.push(codes.join(', '));
  }

  if (parts.length === 0) return 'Filtered binder';
  return parts.slice(0, 4).join(' · ');
}
