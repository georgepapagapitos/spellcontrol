/**
 * Re-export shim — card-type parsing now lives in the isomorphic
 * `@spellcontrol/binder-routing` package (single source of truth). Import
 * paths stay stable.
 */
export {
  TYPE_ORDER,
  getCardType,
  SUPERTYPES,
  TYPES,
  parseTypeLine,
  typeIcon,
} from '@spellcontrol/binder-routing';
