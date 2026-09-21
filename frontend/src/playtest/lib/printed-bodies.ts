import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '@/store/decks';

/** A card's printed body, verbatim from Scryfall — so `*`, `1+*` and `∞` all
 *  arrive unparsed, exactly as {@link PlaytestCard} stores them. */
export interface PrintedBody {
  power: string;
  toughness?: string;
}

export type PrintedBodies = ReadonlyMap<string, PrintedBody>;

/** Cards that print a body at all. Everything else — a land, a ritual, a
 *  Signet — has nothing to look up, and asking for it would make the one
 *  round trip below a whole-deck fetch instead of a short list. */
function printsABody(card: ScryfallCard): boolean {
  return /\b(Creature|Vehicle)\b/.test(card.type_line ?? '');
}

/**
 * Names of the deck's body-printing cards whose STORED copy carries no
 * printed power.
 *
 * A deck keeps a copy of each card as the cache had it when the card was
 * added, so a deck assembled before the cache started keeping
 * `power`/`toughness` holds cards with no body on them at all. Re-ingesting
 * the card cache fixes the cache; it does not rewrite anyone's stored deck.
 *
 * Returns a sorted, de-duplicated list so the caller can use it directly as a
 * memo key.
 */
export function namesMissingBody(deck: Deck): string[] {
  const out = new Set<string>();
  const consider = (card: ScryfallCard | null | undefined): void => {
    if (card?.name && card.power === undefined && printsABody(card)) out.add(card.name);
  };
  for (const slot of deck.cards) consider(slot.card);
  consider(deck.commander);
  consider(deck.partnerCommander);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * The printed bodies among freshly resolved cards, keyed by the name they were
 * asked for.
 *
 * A resolved card with no top-level `power` contributes nothing: that covers
 * both a name that resolved to something bodiless and a double-faced card,
 * whose body lives on its faces and which the board has never read a body from
 * anyway.
 */
export function printedBodiesFrom(resolved: ReadonlyMap<string, ScryfallCard>): PrintedBodies {
  const out = new Map<string, PrintedBody>();
  for (const [name, card] of resolved) {
    if (card.power !== undefined) {
      out.set(name, { power: card.power, toughness: card.toughness });
    }
  }
  return out;
}
