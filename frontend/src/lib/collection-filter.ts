import { cardMatchesCompiled, exactMatchesExpression, type CompiledExpression } from './rules';
import { colorSelectionMatches, getColorKey, type ColorMatchMode } from './colors';
import type { compileFilter } from './rules';
import type { EnrichedCard } from '../types';

type CompiledFilter = ReturnType<typeof compileFilter>;

/** The subset of a collection row this predicate reads. */
export interface FilterableRow {
  card: EnrichedCard;
  binderName: string | null;
}

/**
 * Everything the collection's row predicate needs, already compiled.
 *
 * Six of these can't go through the shared rule engine: binder membership,
 * colour identity (the collection's OR/AND-across-pips semantics differ from
 * the engine's), condition and language (physical-copy fields), tradeable
 * surplus (needs deck allocation) and proxy-only. They ran as post-checks
 * around `cardMatchesCompiled`, inline in CardListTable's `filtered` memo.
 */
export interface CollectionFilterCriteria {
  /** Everything the rule engine handles: type, rarity, oracle, sets, price… */
  matchFilter: CompiledFilter;
  binder?: CompiledExpression | null;
  colors: ReadonlySet<string>;
  colorMode: ColorMatchMode;
  condition?: CompiledExpression | null;
  language?: CompiledExpression | null;
  surplusOnly?: boolean;
  surplusByName?: ReadonlySet<string> | Map<string, unknown>;
  proxyOnly?: boolean;
}

/**
 * Does this row survive the collection's filters?
 *
 * Extracted from CardListTable so the Filters dialog can run the identical
 * predicate over its DRAFT state and show a live match count. Before this, the
 * dialog had no count at all: you set filters against 11.5k cards and pressed
 * Apply blind, then read the result on the page behind you — and if it was
 * zero, reopened the dialog to work out which field did it.
 *
 * Pure and allocation-free per row; it runs once per card per keystroke.
 */
export function rowMatchesCollectionFilter(
  row: FilterableRow,
  c: CollectionFilterCriteria
): boolean {
  if (c.binder) {
    const name = row.binderName ?? '__uncategorized';
    if (!exactMatchesExpression(name, c.binder)) return false;
  }
  if (c.colors.size > 0) {
    const key = getColorKey(row.card);
    const identity = row.card.colorIdentity || [];
    if (!colorSelectionMatches(key, identity, c.colors, c.colorMode)) return false;
  }
  if (c.condition && !exactMatchesExpression(row.card.condition, c.condition)) return false;
  // Absent language means English — the same default CardRow displays.
  if (c.language && !exactMatchesExpression(row.card.language || 'en', c.language)) return false;
  if (c.surplusOnly && !c.surplusByName?.has(row.card.name)) return false;
  if (c.proxyOnly && !row.card.proxy) return false;
  return cardMatchesCompiled(row.card, c.matchFilter);
}

/** How many rows survive. Used for the dialog's live count. */
export function countMatchingRows(
  rows: readonly FilterableRow[],
  c: CollectionFilterCriteria
): number {
  let n = 0;
  for (const row of rows) if (rowMatchesCollectionFilter(row, c)) n++;
  return n;
}
