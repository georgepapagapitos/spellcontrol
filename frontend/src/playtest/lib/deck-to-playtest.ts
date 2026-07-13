import type { Deck, DeckCard } from '@/store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import type { PlaytestCard, PlaytestInit } from '@/lib/playtest';
import { imageFromCard } from '@/lib/card-thumbs';
import { getCardBackFaceUrl, isDoubleFacedCard } from '@/deck-builder/services/scryfall/client';

function instanceId(slotId: string, copy: number): string {
  return `${slotId}#${copy}`;
}

function toPlaytestCard(card: ScryfallCard, id: string): PlaytestCard {
  const imageUrl = imageFromCard(card, 'normal');
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
      ? (getCardBackFaceUrl(card, 'normal') ?? undefined)
      : undefined,
    manaValue: card.cmc,
    typeLine: card.type_line,
  };
}

/**
 * Expand a deck into a flat playtest library. Each `DeckCard` slot represents
 * one physical copy, so we produce exactly one instance per slot — no
 * additional copy expansion.
 */
export function deckToPlaytestInit(deck: Deck, opts: { seed?: number } = {}): PlaytestInit {
  const library: PlaytestCard[] = deck.cards.map((slot: DeckCard, i: number) =>
    toPlaytestCard(slot.card, instanceId(slot.slotId, i))
  );
  const command: PlaytestCard[] = [];
  if (deck.commander) {
    command.push(toPlaytestCard(deck.commander, `cmd-${deck.commander.id}`));
  }
  if (deck.partnerCommander) {
    command.push(toPlaytestCard(deck.partnerCommander, `cmd-${deck.partnerCommander.id}`));
  }
  return { library, command, seed: opts.seed };
}
