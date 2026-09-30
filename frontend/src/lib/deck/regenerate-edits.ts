import type { Customization, ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';

/**
 * What a generated deck looked like the moment it was saved, so a later
 * Regenerate can tell what the player changed since. Names only: an edit is
 * "a card is in or out", so a printing swap or a quantity change never reads
 * as one, and a commander or basic-land change is not a card edit at all.
 */
export interface GeneratedList {
  /** Every non-basic card the generator seated, by name. */
  cards: string[];
  /** The commander (and partner) it was built around. */
  commanders: string[];
}

/** What the player did to the list since it was generated. */
export interface DeckEdits {
  added: string[];
  cut: string[];
}

const isBasic = (card: Pick<ScryfallCard, 'type_line'>): boolean =>
  /\bBasic\b/.test(card.type_line ?? '');

const nonBasicNames = (cards: DeckCard[]): Set<string> =>
  new Set(cards.filter((c) => !isBasic(c.card)).map((c) => c.card.name));

/** Snapshot taken by saveGeneratedDeck, next to the rest of the generation context. */
export function snapshotGeneratedList(
  cards: DeckCard[],
  commander: ScryfallCard | null | undefined,
  partner: ScryfallCard | null | undefined
): GeneratedList {
  return {
    cards: [...nonBasicNames(cards)],
    commanders: [commander?.name, partner?.name].filter((n): n is string => !!n),
  };
}

/**
 * The player's edits to a generated deck, or null when there is nothing to
 * carry: a deck saved before the snapshot existed (guessing would invent
 * edits), or one whose commander was swapped (the old list was built around
 * someone else, so every card would read as cut). Only the main deck counts;
 * a card parked in the sideboard or the considering pile is out of the list.
 */
export function deckEdits(
  deck: Pick<Deck, 'cards' | 'commander' | 'partnerCommander' | 'generationContext'>
): DeckEdits | null {
  const baseline = deck.generationContext?.generatedList;
  if (!baseline) return null;
  const now = [deck.commander?.name, deck.partnerCommander?.name].filter(Boolean);
  if (now.length !== baseline.commanders.length || now.some((n, i) => n !== baseline.commanders[i]))
    return null;
  const before = new Set(baseline.cards);
  const after = nonBasicNames(deck.cards);
  const added = [...after].filter((n) => !before.has(n));
  const cut = [...before].filter((n) => !after.has(n));
  return added.length + cut.length > 0 ? { added, cut } : null;
}

/** The control's label, with the counts the player is agreeing to carry. */
export function keepEditsLabel({ added, cut }: DeckEdits): string {
  return `Keep my edits (${added.length} added, ${cut.length} cut)`;
}

/**
 * The generator fields that carry the edits: added cards join the must-include
 * list, cut cards join the temporary ban list (which the generator clears once
 * it has used it, so a one-off regenerate never touches the saved ban lists).
 * A cut card the source build had pinned is unpinned, since a pin and a ban on
 * one card is a conflict. Turning it off removes exactly what turning it on
 * added, and leaves anything the player typed in since.
 */
export function keepEditsPatch(
  current: Pick<Customization, 'mustIncludeCards' | 'tempBannedCards'>,
  edits: DeckEdits,
  keep: boolean,
  original: readonly string[] = []
): Pick<Customization, 'mustIncludeCards' | 'tempBannedCards'> {
  const cut = new Set(edits.cut);
  const added = new Set(edits.added);
  if (keep) {
    return {
      mustIncludeCards: [
        ...new Set([...current.mustIncludeCards.filter((n) => !cut.has(n)), ...edits.added]),
      ],
      tempBannedCards: [...new Set([...current.tempBannedCards, ...edits.cut])],
    };
  }
  const originalSet = new Set(original);
  return {
    mustIncludeCards: [
      ...new Set([
        ...current.mustIncludeCards.filter((n) => !added.has(n) || originalSet.has(n)),
        ...original.filter((n) => cut.has(n)),
      ]),
    ],
    tempBannedCards: current.tempBannedCards.filter((n) => !cut.has(n)),
  };
}
