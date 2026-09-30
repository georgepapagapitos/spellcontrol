/**
 * The Coach feed's filter chips, its first-page size and its shortcut, plus
 * the empty state for a feed the deck's own settings emptied. Kept beside
 * CoachFeed.tsx so the component stays under the file-size ratchet.
 */
import type { SettingsBreak } from '@/lib/coach/deck-settings-fit';

export type FilterId =
  | 'all'
  | 'fill-gaps'
  | 'upgrade'
  | 'budget'
  | 'collection'
  | 'decks'
  | 'bracket-fit'
  | 'combos'
  | 'lands'
  | 'cuts';

export const FILTER_LABELS: Record<FilterId, string> = {
  all: 'All',
  'fill-gaps': 'Fix gaps',
  upgrade: 'Upgrades',
  budget: 'Budget',
  collection: 'Stand-ins',
  decks: 'Your decks',
  'bracket-fit': 'Bracket',
  combos: 'Combos',
  lands: 'Lands',
  cuts: 'Cuts',
};

/** First page of the feed — enough to fill a laptop viewport below the hero
 *  without walling off the browse catalog and AI strips underneath. */
export const ROW_CAP = 8;

/** tuneFocusLane → feed filter chip mapping. */
export const FOCUS_TO_FILTER: Record<string, FilterId> = {
  'fill-gaps': 'fill-gaps',
  upgrade: 'upgrade',
  budget: 'budget',
  collection: 'collection',
  'bracket-fit': 'bracket-fit',
  lands: 'lands',
};

/**
 * Shortcuts contributed by the Coach feed to the app-wide `?` overlay.
 * STABLE module-level constant — never inline (dep-array reference equality).
 */
export const COACH_SHORTCUTS = [
  { keys: ['f'], description: 'Cycle suggestion filters (All → Fix gaps → Upgrades → …)' },
];

/** Why every suggestion was hidden, named when one setting explains them all. */
const SETTINGS_EMPTY_HINT: Record<SettingsBreak, string> = {
  unowned: "This deck is built from your collection, and every suggestion is a card you don't own.",
  'owned-share': 'Each suggestion would take the deck under its share of owned cards.',
  'over-card-price': "Every suggestion costs more than this deck's price cap per card.",
  'over-budget': 'Every suggestion would take the deck over its budget.',
  'over-rarity': "Every suggestion is above this deck's rarity cap.",
  'over-game-changers': 'Every suggestion is a Game Changer past what this deck allows.',
};

/**
 * The empty state's hint when the deck's settings hid every suggestion: the
 * one setting behind all of them, or a reason-agnostic line when it's several.
 */
export function settingsEmptyHint(reasons: readonly SettingsBreak[]): string {
  const distinct = new Set(reasons);
  if (distinct.size === 1) return SETTINGS_EMPTY_HINT[reasons[0]];
  return "Every suggestion breaks one of this deck's build settings.";
}
