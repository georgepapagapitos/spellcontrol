/**
 * @spellcontrol/binder-routing — isomorphic binder routing engine.
 *
 * Owns card-to-binder rule matching, filtering, sorting, sectioning, and
 * materialization. Pure functions, zero runtime dependencies. Consumed by the
 * SpellControl frontend (live binder views) and backend (shared-binder
 * projections) via `file:` deps, mirroring the `@spellcontrol/game-core`
 * single-source-of-truth pattern.
 */

export * from './types.js';
export * from './colors.js';
export * from './card-types.js';
export * from './commanders-core.js';
export * from './normalize-search.js';
export * from './sections.js';
export * from './sorting.js';
export * from './rules.js';
export * from './materialize.js';
