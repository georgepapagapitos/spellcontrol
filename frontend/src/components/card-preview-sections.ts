/**
 * The single source of truth for CardPreview's *collapsed* curation — which
 * info-panel sections survive when the panel is collapsed, per surface. Lives
 * in its own module (not inside CardPreview.tsx) so the policy is importable
 * and unit-testable on its own, and so CardPreview.tsx keeps to component-only
 * exports (react-refresh friendly).
 *
 * Replaces the old one-size-fits-all CSS `display:none` block that was tuned
 * only for the deck view and wrongly hid set/printing + context everywhere
 * else. Expanding the panel always reveals everything; this only governs the
 * collapsed snapshot.
 */

/** Which surface opened the preview. Selects the collapsed policy below. */
export type CardPreviewSource =
  | 'deck'
  | 'collection'
  | 'binder'
  | 'suggestion'
  | 'search'
  | 'playtest';

/** A togglable section of the info panel. The card name is always shown (it's
 *  the card's identity), so it isn't listed here. `panelMeta`/`panelExtra` are
 *  the two caller-injected slots. */
export type CardPreviewSection =
  | 'context'
  | 'panelMeta'
  | 'meta'
  | 'role'
  | 'set'
  | 'links'
  | 'panelExtra'
  | 'counter';

// Per surface, the at-a-glance essentials kept while collapsed:
//   deck       — the contextual meta block (partner/role/inclusion/legality) + price
//   collection — set/printing, finish + price + qty, and binder/deck membership
//   binder     — binder membership + page position + price
//   suggestion — why the card surfaced (the carousel label) + role + price
//   search     — price + the inline printing/finish picker (the surface's action)
//   playtest   — just price (plus the always-on name + image)
const COLLAPSED_SECTIONS: Record<CardPreviewSource, readonly CardPreviewSection[]> = {
  deck: ['panelMeta', 'meta'],
  collection: ['context', 'meta', 'set'],
  binder: ['context', 'meta', 'counter'],
  suggestion: ['context', 'meta', 'role'],
  search: ['meta', 'panelExtra'],
  playtest: ['meta'],
};

// Fallback for call sites that don't declare a `source` — mirrors the
// pre-curation generic behavior (name + meta block + price + role + the extra
// slot; context/set/links/counter deferred) so an omitted source never
// regresses a surface that hasn't been migrated.
const DEFAULT_COLLAPSED_SECTIONS: readonly CardPreviewSection[] = [
  'panelMeta',
  'meta',
  'role',
  'panelExtra',
];

/** Resolve which panel sections stay visible when collapsed: an explicit
 *  `collapsedSections` override wins, else the `source` policy, else the
 *  generic default. Pure so the policy is unit-testable without rendering the
 *  (DOM-heavy) preview. */
export function collapsedSectionsFor(
  source?: CardPreviewSource,
  collapsedSections?: readonly CardPreviewSection[]
): readonly CardPreviewSection[] {
  return collapsedSections ?? (source ? COLLAPSED_SECTIONS[source] : DEFAULT_COLLAPSED_SECTIONS);
}
