/**
 * Pure filter logic for the shared collection / binder / deck views. Reuses the
 * SAME matching engine (`@spellcontrol/binder-routing`) the authed collection
 * uses, so shared views filter identically instead of maintaining a parallel
 * hand-rolled predicate.
 *
 * The public share payload (`PublicCard`) is a structural near-superset of the
 * engine's `EnrichedCard` — the fields it reads (typeLine, colorIdentity, cmc,
 * rarity, setCode, layout, manaCost, finish, …) already line up by name — so the
 * adapter just supplies the few required-but-unread fields plus name-derived
 * oracle `tags`. Facets the slim payload can't back (oracle text, legality,
 * treatment, border) are simply not exposed by the shared filter UI.
 *
 * Kept store-agnostic: shared views must not touch zustand stores.
 */
import type { PublicCard } from './shared-types';
import type { BinderFilter, ChipExpression, EnrichedCard } from '../types';
import { getCardTags } from './card-tags';
import { getColorKey } from './colors';
import { cardMatchesCompiled, compileFilter, isExpressionEmpty } from './rules';

/** Committed filter state the shared views hold and the dialog edits. */
export interface SharedFilterState {
  supertypeExpr: ChipExpression;
  typesExpr: ChipExpression;
  subtypeExpr: ChipExpression;
  /** Color-identity codes W/U/B/R/G + C (colorless). */
  colorFilter: ReadonlySet<string>;
  rarityExpr: ChipExpression;
  oracleTagExpr: ChipExpression;
  layoutExpr: ChipExpression;
  finishExpr: ChipExpression;
  /** Selected set codes (uppercased). */
  setFilter: ReadonlySet<string>;
  cmcMin?: number;
  cmcMax?: number;
  priceMin?: number;
  priceMax?: number;
}

/**
 * Adapt a `PublicCard` to the `EnrichedCard` shape the routing engine matches
 * against. Field names already align; `tags` is decorated from the name-keyed
 * snapshot (empty until it loads), and the required-but-unread copy fields get
 * harmless stubs.
 */
export function toEnrichedForMatch(pc: PublicCard): EnrichedCard {
  return {
    copyId: pc.scryfallId,
    name: pc.name,
    oracleId: pc.oracleId,
    setCode: pc.setCode,
    setName: pc.setName,
    collectorNumber: pc.collectorNumber,
    rarity: pc.rarity,
    scryfallId: pc.scryfallId,
    purchasePrice: pc.purchasePrice,
    sourceCategory: '',
    sourceFormat: '',
    finish: pc.finish,
    foil: pc.foil,
    cmc: pc.cmc,
    typeLine: pc.typeLine,
    colorIdentity: pc.colorIdentity,
    colors: pc.colors,
    layout: pc.layout,
    manaCost: pc.manaCost,
    tags: getCardTags(pc.name),
  };
}

/** Build the engine `BinderFilter` from committed shared state (empty facets omitted). */
export function buildSharedBinderFilter(s: SharedFilterState): BinderFilter {
  const f: BinderFilter = {};
  if (!isExpressionEmpty(s.supertypeExpr)) f.supertypeChips = s.supertypeExpr;
  if (!isExpressionEmpty(s.typesExpr)) f.typeTokenChips = s.typesExpr;
  if (!isExpressionEmpty(s.subtypeExpr)) f.subtypeChips = s.subtypeExpr;
  if (!isExpressionEmpty(s.rarityExpr)) f.rarities = s.rarityExpr;
  if (!isExpressionEmpty(s.oracleTagExpr)) f.oracleTagChips = s.oracleTagExpr;
  if (!isExpressionEmpty(s.layoutExpr)) f.layouts = s.layoutExpr;
  if (!isExpressionEmpty(s.finishExpr)) f.finishes = s.finishExpr;
  if (s.setFilter.size > 0) f.setCodes = [...s.setFilter].map((c) => c.toUpperCase());
  if (s.priceMin !== undefined) f.priceMin = s.priceMin;
  if (s.priceMax !== undefined) f.priceMax = s.priceMax;
  if (s.cmcMin !== undefined) f.cmcMin = s.cmcMin;
  if (s.cmcMax !== undefined) f.cmcMax = s.cmcMax;
  return f;
}

/**
 * Color-identity post-check — kept separate from the engine filter because the
 * collection uses the same "any selected color in identity (C = colorless)"
 * semantics rather than the engine's color-key rule (mirrors CardListTable).
 */
export function colorMatches(card: EnrichedCard, colorFilter: ReadonlySet<string>): boolean {
  if (colorFilter.size === 0) return true;
  const k = getColorKey(card);
  const ci = card.colorIdentity ?? [];
  return (
    (k === 'C' && colorFilter.has('C')) ||
    ci.some((c) => colorFilter.has(c)) ||
    (k !== 'C' && colorFilter.has(k))
  );
}

/**
 * Build a per-card predicate from committed shared state. Compiles the engine
 * filter once; the returned function adapts + color-checks + engine-matches each
 * card.
 */
export function makeSharedMatcher(state: SharedFilterState): (pc: PublicCard) => boolean {
  const compiled = compileFilter(buildSharedBinderFilter(state));
  return (pc) => {
    const card = toEnrichedForMatch(pc);
    if (!colorMatches(card, state.colorFilter)) return false;
    return cardMatchesCompiled(card, compiled);
  };
}

/** Count of active facets — drives the filter-button badge. */
export function countActiveSharedFilters(s: SharedFilterState): number {
  return (
    (isExpressionEmpty(s.supertypeExpr) ? 0 : 1) +
    (isExpressionEmpty(s.typesExpr) ? 0 : 1) +
    (isExpressionEmpty(s.subtypeExpr) ? 0 : 1) +
    s.colorFilter.size +
    (isExpressionEmpty(s.rarityExpr) ? 0 : 1) +
    (isExpressionEmpty(s.oracleTagExpr) ? 0 : 1) +
    (isExpressionEmpty(s.layoutExpr) ? 0 : 1) +
    (isExpressionEmpty(s.finishExpr) ? 0 : 1) +
    s.setFilter.size +
    (s.priceMin !== undefined || s.priceMax !== undefined ? 1 : 0) +
    (s.cmcMin !== undefined || s.cmcMax !== undefined ? 1 : 0)
  );
}
