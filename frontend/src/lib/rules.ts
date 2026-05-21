/**
 * Re-export shim — the binder rule-matching engine now lives in the isomorphic
 * `@spellcontrol/binder-routing` package (single source of truth, shared with
 * the backend's shared-binder projections). Import paths stay stable.
 */
export {
  compileFilter,
  cardMatchesCompiled,
  cardMatchesFilter,
  compileFilterGroups,
  cardMatchesAnyGroup,
  legalityMatchesExpression,
  effectiveTreatments,
  areAllGroupsEmpty,
  isFilterEmpty,
  isExpressionEmpty,
  compileExpression,
  substringMatchesExpression,
  exactMatchesExpression,
  setMatchesExpression,
} from '@spellcontrol/binder-routing';
export type { CompiledExpression } from '@spellcontrol/binder-routing';
