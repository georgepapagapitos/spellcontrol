import { matchSortPreset, describeSortChain } from './sorting';
import type { SortEntry } from '../types';

/**
 * The one label every sort surface shows for a chain: a matching named
 * order's name ("Set collection"), or the chain spelled out in words when
 * nothing matches ("Rarity, then price"). Shared so the pill, the sort sheet
 * header and the binder editor's Order summary can never disagree about what
 * a chain is called (E491).
 */
export function sortOrderSummaryLabel(sorts: SortEntry[]): string {
  const preset = matchSortPreset(sorts);
  return preset ? preset.name : describeSortChain(sorts) || 'Choose fields';
}
