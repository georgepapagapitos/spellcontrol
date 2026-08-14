/**
 * Re-export shim — color grouping now lives in the isomorphic
 * `@spellcontrol/binder-routing` package (single source of truth, shared with
 * the backend's shared-binder projections). Import paths stay stable.
 */
export {
  getColorPalette,
  getColorKey,
  isLand,
  COLOR_INFO,
  COLOR_ORDER,
} from '@spellcontrol/binder-routing';

/**
 * How a multi-color pip selection combines: `'any'` (OR — a card matches if it
 * shows any selected color; the historical default) or `'all'` (AND — a card
 * must show every selected color, so R + W means Boros cards).
 */
export type ColorMatchMode = 'any' | 'all';

/**
 * The single color-filter predicate behind every WUBRG+C pip row (collection,
 * lists, deck add-cards, shared views, friend collections). `key` is the
 * card's grouping key (`getColorKey`): 'C' for colorless, a color letter for
 * mono cards (covers printings whose `colorIdentity` is missing — resolved by
 * basic-land name), 'M' for multicolor. Selecting 'C' means "colorless"; in
 * 'all' mode combining it with a color is unsatisfiable and correctly matches
 * nothing.
 */
export function colorSelectionMatches(
  key: string,
  colorIdentity: readonly string[],
  selected: ReadonlySet<string>,
  mode: ColorMatchMode = 'any'
): boolean {
  if (selected.size === 0) return true;
  const has = (c: string) => (c === 'C' ? key === 'C' : colorIdentity.includes(c) || key === c);
  const picks = [...selected];
  return mode === 'all' ? picks.every(has) : picks.some(has);
}
