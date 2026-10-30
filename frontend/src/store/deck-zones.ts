import type { Deck, DeckCard } from './decks';

/**
 * Every deck zone made of `DeckCard` slots, each of which can claim a physical
 * copy. Readers that ask "which copies does this deck hold" (the allocation
 * map, dedupe, remap, copy claims) loop over this list instead of naming the
 * zones, so a new zone is claimed everywhere once it is added here. A zone
 * missing from a claim reader shows its copy as free, and a second deck takes
 * it. `deck-zones.test.ts` fails when a `DeckCard[]` field on `Deck` is not
 * listed.
 *
 * - `cards`: the mainboard.
 * - `sideboard`: the format sideboard.
 * - `considering`: cards parked for later (E122).
 * - `extras`: "In the box". Physical cards that came with the deck but are
 *   not played, such as a precon's display commander. Like `considering`, it
 *   feeds no stats, legality, mana or export.
 */
export const DECK_SLOT_ZONES = ['cards', 'sideboard', 'considering', 'extras'] as const;

/** One of the {@link DECK_SLOT_ZONES}. */
export type DeckZone = (typeof DECK_SLOT_ZONES)[number];

/** A zone's slots, `[]` for one a row persisted before the zone existed. */
export function zoneSlots(deck: Pick<Deck, DeckZone>, zone: DeckZone): DeckCard[] {
  return deck[zone] ?? [];
}

/** Every slot in the deck, zone by zone, mainboard first. */
export function allZoneSlots(deck: Pick<Deck, DeckZone>): DeckCard[] {
  return DECK_SLOT_ZONES.flatMap((zone) => zoneSlots(deck, zone));
}
