import type { Deck, DeckCard } from '@/store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import type { PlaytestCard, PlaytestInit } from '@/lib/playtest';
import type { EnrichedCard } from '@/types';
import { playtestLifeConfig } from '@/lib/playtest';
import { imageFromCard } from '@/lib/card-thumbs';
import { getCardBackFaceUrl, isDoubleFacedCard } from '@/deck-builder/services/scryfall/client';

function instanceId(slotId: string, copy: number): string {
  return `${slotId}#${copy}`;
}

/**
 * `owned` is the collection copy the deck slot is allocated to, if any. Its
 * printing is the one the deck view shows (deck-display-rows prefers it), so
 * it is the one the table shows: the card you sleeved, not whichever printing
 * the slot happened to be added as.
 */
function toPlaytestCard(card: ScryfallCard, id: string, owned?: EnrichedCard): PlaytestCard {
  const imageUrl = owned?.imageNormal ?? imageFromCard(card, 'normal');
  return {
    id,
    name: card.name,
    oracleId: card.oracle_id,
    scryfallId: card.id,
    imageUrl,
    // Only genuine two-faced cards (transform/MDFC) get a back image — this
    // doubles as the "Transform is eligible" signal the UI checks, so a
    // single-faced card never needs a separate ScryfallCard lookup to decide.
    backImageUrl: isDoubleFacedCard(card)
      ? (owned?.imageNormalBack ?? getCardBackFaceUrl(card, 'normal') ?? undefined)
      : undefined,
    manaValue: card.cmc,
    manaCost: card.mana_cost,
    typeLine: card.type_line,
    // Printed body, verbatim — the card face adds any hand-applied
    // modifier to it (see lib/power-toughness.ts). Absent for everything
    // that isn't a creature or a vehicle, which is what stops the badge
    // rendering on a land.
    power: card.power,
    toughness: card.toughness,
  };
}

/**
 * Expand a deck into a flat playtest library. Each `DeckCard` slot represents
 * one physical copy, so we produce exactly one instance per slot — no
 * additional copy expansion.
 */
export function deckToPlaytestInit(
  deck: Deck,
  opts: {
    seed?: number;
    /** The collection by copy id, for the printing each allocated slot holds.
     *  Omitted (or a slot with no allocation) uses the slot's stored card. */
    collectionById?: ReadonlyMap<string, EnrichedCard>;
  } = {}
): PlaytestInit {
  const ownedCopy = (copyId: string | null | undefined) =>
    copyId ? opts.collectionById?.get(copyId) : undefined;
  const library: PlaytestCard[] = deck.cards.map((slot: DeckCard, i: number) =>
    toPlaytestCard(slot.card, instanceId(slot.slotId, i), ownedCopy(slot.allocatedCopyId))
  );
  const command: PlaytestCard[] = [];
  if (deck.commander) {
    command.push(
      toPlaytestCard(
        deck.commander,
        `cmd-${deck.commander.id}`,
        ownedCopy(deck.commanderAllocatedCopyId)
      )
    );
  }
  if (deck.partnerCommander) {
    command.push(
      toPlaytestCard(
        deck.partnerCommander,
        `cmd-${deck.partnerCommander.id}`,
        ownedCopy(deck.partnerCommanderAllocatedCopyId)
      )
    );
  }
  return {
    library,
    command,
    seed: opts.seed,
    life: playtestLifeConfig(deck.format).life,
  };
}
