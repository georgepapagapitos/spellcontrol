import type { EnrichedCard, SortField } from '../types';
import { COLOR_INFO, getColorKey } from './colors';
import { TYPE_ORDER, getCardType } from './card-types';

export const SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'color', label: 'Color' },
  { value: 'type', label: 'Type' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'cmc', label: 'CMC' },
  { value: 'name', label: 'Name' },
  { value: 'set', label: 'Set' },
  { value: 'price', label: 'Price' },
  { value: 'edhrec', label: 'EDHREC rank' },
];

const RARITY_ORDER: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
};

export function cardSortValue(card: EnrichedCard, field: SortField): number | string {
  switch (field) {
    case 'color':
      return COLOR_INFO[getColorKey(card)]?.order ?? 99;
    case 'type': {
      const idx = TYPE_ORDER.indexOf(getCardType(card));
      return idx === -1 ? 99 : idx;
    }
    case 'rarity':
      return RARITY_ORDER[card.rarity.toLowerCase()] ?? 9;
    case 'cmc':
      return card.cmc ?? 999;
    case 'name':
      return card.name.toLowerCase();
    case 'set':
      return (card.setName || card.setCode).toLowerCase();
    case 'price':
      return -card.purchasePrice;
    case 'edhrec':
      // Lower rank = more popular = should come first. Cards with no rank go to the end.
      return card.edhrecRank ?? Number.MAX_SAFE_INTEGER;
    default:
      return 0;
  }
}

export function sortCards(cards: EnrichedCard[], sorts: SortField[]): EnrichedCard[] {
  const active = sorts.filter((s) => s && s !== 'none');
  if (active.length === 0) return [...cards];

  return [...cards].sort((a, b) => {
    for (const field of active) {
      const va = cardSortValue(a, field);
      const vb = cardSortValue(b, field);
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  });
}

/** Suggested defaults for newly-created binders. */
export const NEW_BINDER_DEFAULT_SORTS: SortField[] = ['name'];

/** Maximum number of sort fields a binder can chain. */
export const MAX_SORTS = 3;
