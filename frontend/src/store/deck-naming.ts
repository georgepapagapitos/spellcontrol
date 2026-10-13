import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from './decks';
import { withoutReleased } from './deck-copy-claims';

// What a deck is called, and the one mutator that seats a commander, since
// seating one is what renames an untitled deck.

/** The name a deck gets when it's created with no name and no commander. */
export const UNTITLED_DECK_NAME = 'Untitled deck';

/**
 * A commander's short name: everything before the first comma for two-name
 * commanders ("Korvold, Fae-Cursed King" → "Korvold"). What a new deck is
 * named after, and what the editor calls the commander in a toast.
 */
export function commanderShortName(commander: ScryfallCard): string {
  return commander.name.split(',')[0].trim();
}

export function defaultDeckName(commander: ScryfallCard | null): string {
  return commander ? commanderShortName(commander) : UNTITLED_DECK_NAME;
}

/**
 * The deck with `card` in the command zone. A deck still carrying the
 * placeholder name takes the incoming commander's short name, the same rule
 * `createDeck` uses, so a deck started empty and given a commander later reads
 * the same as one created with it (E465). Only a CHANGE of commander renames:
 * re-seating the same card (releasing its copy claim, a cross-deck move) is
 * not a pick. Only the store's own mutators call this. A server pull or an
 * undo writes the whole row through `setState`/`replaceDeck` and never passes
 * here, so a commander arriving from another device can't rename anything.
 */
export function withCommander(d: Deck, card: ScryfallCard | null, allocated: string | null): Deck {
  return {
    ...withoutReleased(d, 'commanderReleased'),
    name: deckNameForCommander(d, card),
    commander: card,
    commanderAllocatedCopyId: allocated,
  };
}

/**
 * The name `deck` should carry once `next` is its commander: the incoming
 * commander's short name when the deck still has the placeholder name and the
 * commander actually changes, else the name it already has. The rule behind
 * {@link withCommander}, exported for the dialogs that commit a whole deck
 * through `replaceDeck` (Paste cards, Bulk edit) so every way of picking a
 * commander names the deck the same way.
 */
export function deckNameForCommander(
  deck: Pick<Deck, 'name' | 'commander'>,
  next: ScryfallCard | null
): string {
  const rename = !!next && deck.name === UNTITLED_DECK_NAME && deck.commander?.name !== next.name;
  return rename ? defaultDeckName(next) : deck.name;
}
