/**
 * The single dedup choke point for the first-publish seal moment (E150),
 * shared by every entry surface that can turn a deck public for the first
 * time — the deck-editor visibility chip and post-create nudge (both via
 * ShareDialog's `doPublish`), and the creation-time fieldset on /decks/new
 * and the single-deck import flow (via `usePublishOnCreate`, which can't
 * fire directly — see its own doc comment — and instead hands the outcome
 * to DeckEditorPage's `justPublished` landing effect). All four routes
 * funnel through this one function so "once per deck per app-open" holds
 * regardless of entry surface, mirroring the canonical module-level-Set
 * pattern (`celebratedDeckComplete` in DeckDisplay.tsx,
 * `celebratedBinderCleared` in BinderDriftBanner.tsx) but centralized here
 * instead of forked per file, since this guard has more than one call site.
 */
const celebratedFirstPublish = new Set<string>();

/**
 * True exactly once per deckId: the first time a publish response reports a
 * genuine first-ever publish (`isFirstPublish`, derived from the server's
 * 201-vs-200 — see `publishDeck` in publications-client.ts). A refresh-while-
 * live or a republish after unpublish reports `isFirstPublish: false` and
 * never celebrates, satisfying "republish is not a first publish" even
 * without consulting the Set. The Set itself guards the rarer case of this
 * being called twice for the same genuine first publish (defensive, matches
 * the established pattern) and persists for the life of the module — i.e.
 * once per app-open, same lifetime as the two per-file precedents above.
 */
export function shouldCelebrateFirstPublish(deckId: string, isFirstPublish: boolean): boolean {
  if (!isFirstPublish || celebratedFirstPublish.has(deckId)) return false;
  celebratedFirstPublish.add(deckId);
  return true;
}
