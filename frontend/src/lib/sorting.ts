/**
 * Re-export shim — card sorting now lives in the isomorphic
 * `@spellcontrol/binder-routing` package (single source of truth). Import
 * paths stay stable.
 */
export {
  SORT_FIELDS,
  TREATMENT_KEYS,
  FINISH_KEYS,
  getTreatmentKey,
  getFinishKey,
  CUSTOMIZABLE_VALUE_ORDER_FIELDS,
  getDefaultValueOrder,
  getValueLabel,
  resolveValueOrder,
  treatmentRank,
  finishRank,
  printingKey,
  buildQtyByPrintingKey,
  RARITY_ORDER,
  CANONICAL_MULTICOLOR,
  colorSortRank,
  cardSortValue,
  sortCards,
  NEW_BINDER_DEFAULT_SORTS,
  MAX_SORTS,
  IMPLICIT_TIEBREAKER_FIELDS,
  describeSortOrder,
  isValueOrderCustomized,
  getDisplaySorts,
  getImplicitTiebreakers,
  sortEntryLabel,
} from '@spellcontrol/binder-routing';
export type { SortContext, TreatmentKey, FinishKey } from '@spellcontrol/binder-routing';
