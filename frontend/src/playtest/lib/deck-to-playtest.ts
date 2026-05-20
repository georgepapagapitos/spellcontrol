import type { Deck, DeckCard } from '@/store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import type { PlaytestCard, PlaytestInit } from '@/lib/playtest';

function instanceId(slotId: string, copy: number): string {
  return `${slotId}#${copy}`;
}

function toPlaytestCard(card: ScryfallCard, id: string): PlaytestCard {
  const face = card.card_faces?.[0];
  const imageUrl =
    card.image_uris?.normal ?? card.image_uris?.large ?? face?.image_uris?.normal ?? undefined;
  return {
    id,
    name: card.name,
    oracleId: card.oracle_id,
    scryfallId: card.id,
    imageUrl,
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
