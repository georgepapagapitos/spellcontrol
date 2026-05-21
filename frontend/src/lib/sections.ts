/**
 * Re-export shim — binder section metadata now lives in the isomorphic
 * `@spellcontrol/binder-routing` package (single source of truth). Import
 * paths stay stable.
 */
export { getSectionMeta, ALL_SECTION } from '@spellcontrol/binder-routing';
export type { SectionContext, SectionMeta } from '@spellcontrol/binder-routing';
