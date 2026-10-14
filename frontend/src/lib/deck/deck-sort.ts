import type { SortMenuOption } from '@/components/search/SortMenu';
import type { SortDir } from '@/types/index';
import type { Deck } from '@/store/decks';

/**
 * How a list of decks sorts. The decks index and every deck picker share these
 * fields and their wording, so "Date edited, Newest first" means the same
 * order wherever a list of your decks appears.
 */
export type DeckSortField = 'edited' | 'created' | 'name' | 'commander' | 'cards' | 'value';

// Decks sort on their own keys, so the direction wording is authored here —
// each phrased as what it does to the rows, never asc/desc.
export const DECK_SORT_OPTIONS: SortMenuOption<DeckSortField>[] = [
  { value: 'edited', label: 'Date edited', dirLabels: ['Oldest first', 'Newest first'] },
  { value: 'created', label: 'Date created', dirLabels: ['Oldest first', 'Newest first'] },
  { value: 'name', label: 'Name', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'commander', label: 'Commander', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'cards', label: 'Card count', dirLabels: ['Fewest', 'Most'] },
  { value: 'value', label: 'Value', dirLabels: ['Cheapest', 'Priciest'] },
];

export const DECK_SORT_DEFAULT_DIR: Record<DeckSortField, SortDir> = {
  edited: 'desc',
  created: 'desc',
  name: 'asc',
  commander: 'asc',
  cards: 'desc',
  value: 'desc',
};

/** Commander(s) plus the main deck: the count a deck tile prints. */
export function deckCardTotal(deck: Deck): number {
  return (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0) + deck.cards.length;
}

/** The key one deck sorts on. `value` reads from `values`; a deck missing from it sorts as 0. */
export function deckSortValue(
  deck: Deck,
  field: DeckSortField,
  values?: ReadonlyMap<string, number>
): number | string {
  switch (field) {
    case 'edited':
      return deck.updatedAt;
    case 'created':
      return deck.createdAt;
    case 'name':
      return deck.name.toLowerCase();
    case 'commander':
      return (deck.commander?.name ?? '').toLowerCase();
    case 'cards':
      return deckCardTotal(deck);
    case 'value':
      return values?.get(deck.id) ?? 0;
  }
}

/** A sorted copy of `decks`. */
export function sortDecks(
  decks: readonly Deck[],
  field: DeckSortField,
  dir: SortDir,
  values?: ReadonlyMap<string, number>
): Deck[] {
  return [...decks].sort((a, b) => {
    const va = deckSortValue(a, field, values);
    const vb = deckSortValue(b, field, values);
    if (va < vb) return dir === 'desc' ? 1 : -1;
    if (va > vb) return dir === 'desc' ? -1 : 1;
    return 0;
  });
}
