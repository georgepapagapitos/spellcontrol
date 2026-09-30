import type { Deck } from '../../store/decks';
import { searchCards } from '../../deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

// Fetch strong on-color fixing lands for the "Re-analyze lands" tool's acquire
// rows (duals the user may not own yet). The deck's identity letters are passed
// as the search hook's query string; this parses them back into a color filter.
// edhrec order surfaces the popular duals first, bounded by the hook's limit.
// Module-level (stable ref) as useSearchCards requires. Basics excluded; the
// merit engine ranks and filters what's returned.
export const fetchFixingLands = (identityKey: string): Promise<ScryfallCard[]> =>
  searchCards('t:land -t:basic', identityKey.split(''), { order: 'edhrec' }).then((r) => r.data);

/** Functional role key → display label (the four roles the tagger classifies). */
export const ROLE_LABEL: Record<string, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board wipes',
  cardDraw: 'Card advantage',
};

/** Shortcut items contributed to the registry under the "Deck editor" section. */
export const DECK_EDITOR_SHORTCUTS = [
  { keys: ['/'], description: 'Open card search' },
  { keys: ['a'], description: 'Open Coach tab (suggestions)' },
  { keys: ['c'], description: 'Open Power tab with combos' },
  { keys: ['Cmd/Ctrl+Z'], description: 'Undo last edit' },
  { keys: ['Cmd/Ctrl+Shift+Z'], description: 'Redo last edit' },
];

// "Owned only" Coach toggle — persisted here (the page owns the state) so both
// the feed and the Next-best-move hero, which is built upstream, share it.
export const OWNED_ONLY_KEY = 'spellcontrol-improve-owned-only';
/** Stable initial value for the deferred cross-deck scan (a fresh [] would re-render). */
export const NO_DECKS: Deck[] = [];
export function readOwnedOnly(): boolean {
  try {
    return window.localStorage.getItem(OWNED_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}
