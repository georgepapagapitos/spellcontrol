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
