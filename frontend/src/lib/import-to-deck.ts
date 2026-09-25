import type { Deck, DeckCard } from '@/store/decks';
import type { DeckFormat, ScryfallCard } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { namedPartner } from '@/deck-builder/lib/partnerUtils';
import { pickRandomPresetColor } from './preset-colors';
import type { DeckImportResponse } from '../types';

/**
 * Turns a parsed import into a `Deck` that exists only in memory, so a list
 * can be goldfished without first becoming a saved deck.
 *
 * Every other door into a board takes a persisted deck: `/decks/:id/playtest`
 * resolves one from the store, the shared routes fetch a published one, and
 * importing always commits a new deck first. A list somebody pasted from a
 * forum post is none of those, and making them save it to try it is the
 * friction every comparable client does without.
 *
 * Deliberately NOT the same path as an import: nothing here allocates a
 * physical copy from the collection (`buildDeckInputFromImport` does that,
 * and it is an owner-side concept this deck has no business claiming), and
 * nothing is written to any store. Modelled on `public-deck-to-deck.ts`,
 * which solves the same problem for a deck the viewer does not own.
 */

/**
 * Namespaced like `publicDeckLocalId`, so this deck's id can never collide
 * with a real one in the viewer's store — deck-id-keyed local state (playtest
 * snapshots, session history) stays separate from any saved deck's.
 *
 * The id carries a token so two different pasted lists do not share a resume
 * snapshot; pasting the same list twice deliberately DOES, which is what makes
 * a refresh mid-goldfish offer to pick up where it left off.
 */
export function pastedDeckLocalId(token: string): string {
  return `pasted:${token}`;
}

/** A short, stable token for a pasted list: same text, same id. */
export function pastedListToken(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function toDeckCards(cards: readonly ScryfallCard[], zone: string): DeckCard[] {
  return cards.map((card, i) => ({
    slotId: `paste-${zone}-${i}`,
    card,
    // Nothing pasted is claimed against the collection — see the module doc.
    allocatedCopyId: null,
  }));
}

/** Only a format we have a config for; anything else reads as commander. */
function toFormat(format: string | undefined): DeckFormat {
  return (
    format && Object.prototype.hasOwnProperty.call(DECK_FORMAT_CONFIGS, format)
      ? format
      : 'commander'
  ) as DeckFormat;
}

/**
 * `localId` is the caller's already-namespaced deck id — `pastedDeckLocalId`
 * for a pasted list, `starterDeckLocalId` for a starter deck. It is the
 * caller's because the id is what keys the deck's board state, and only the
 * caller knows what makes two sessions the same session.
 */
export function importToDeck(result: DeckImportResponse, localId: string, name: string): Deck {
  const now = Date.now();
  // A partner the list named under Commander starts in the command zone, with
  // its own tax coin, as it does at a table. The server also lists it among
  // the cards, so one copy of it comes out of the 99.
  const partner = namedPartner(result.commander, result.partner);
  const partnerAt = partner ? result.cards.findIndex((c) => c.name === partner.name) : -1;
  const cards = result.cards.filter((_, i) => i !== partnerAt);
  return {
    id: localId,
    name,
    format: toFormat(result.detectedFormat),
    source: 'manual',
    commander: result.commander,
    partnerCommander: partner,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: toDeckCards(cards, 'main'),
    sideboard: toDeckCards(result.sideboard ?? [], 'side'),
    considering: [],
    generationContext: null,
    color: pickRandomPresetColor(),
    createdAt: now,
    updatedAt: now,
  };
}
