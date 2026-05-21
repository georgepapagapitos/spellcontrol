/**
 * Re-export shim — binder materialization now lives in the isomorphic
 * `@spellcontrol/binder-routing` package (single source of truth, shared with
 * the backend's shared-binder projections). Import paths stay stable.
 */
export { materializeBinders } from '@spellcontrol/binder-routing';
export type { MaterializeOptions } from '@spellcontrol/binder-routing';
