import type { EnrichedCard, SortDir, SortEntry, SortField } from '../types';
import { COLOR_INFO, getColorKey } from './colors';
import { TYPE_ORDER, getCardType } from './card-types';
import type { SetMap } from './api';

export interface SortContext {
  setMap?: SetMap;
}

export const SORT_FIELDS: { value: SortField; label: string; defaultDir: SortDir }[] = [
  { value: 'color', label: 'Color', defaultDir: 'asc' },
  { value: 'type', label: 'Type', defaultDir: 'asc' },
  { value: 'rarity', label: 'Rarity', defaultDir: 'asc' },
  { value: 'cmc', label: 'CMC', defaultDir: 'asc' },
  { value: 'name', label: 'Name', defaultDir: 'asc' },
  { value: 'set', label: 'Set', defaultDir: 'asc' },
  { value: 'price', label: 'Price', defaultDir: 'desc' },
  { value: 'edhrec', label: 'EDHREC rank', defaultDir: 'asc' },
  { value: 'collectorNumber', label: 'Collector #', defaultDir: 'asc' },
];

export const RARITY_ORDER: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  special: 4,
  bonus: 5,
};

export function cardSortValue(
  card: EnrichedCard,
  field: SortField,
  ctx?: SortContext
): number | string {
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
    case 'set': {
      const code = (card.setCode || '').toUpperCase();
      const released = ctx?.setMap?.[code]?.releasedAt;
      if (released) return released;
      return (card.setName || card.setCode).toLowerCase();
    }
    case 'price':
      return card.purchasePrice;
    case 'edhrec':
      return card.edhrecRank ?? Number.MAX_SAFE_INTEGER;
    case 'collectorNumber': {
      const n = parseInt(card.collectorNumber, 10);
      return isNaN(n) ? 99999 : n;
    }
    default:
      return 0;
  }
}

export function sortCards(
  cards: EnrichedCard[],
  sorts: SortEntry[],
  ctx?: SortContext
): EnrichedCard[] {
  const active = sorts.filter((s) => s && s.field !== 'none');
  if (active.length === 0) return [...cards];

  return [...cards].sort((a, b) => {
    for (const { field, dir } of active) {
      const va = cardSortValue(a, field, ctx);
      const vb = cardSortValue(b, field, ctx);
      if (va < vb) return dir === 'desc' ? 1 : -1;
      if (va > vb) return dir === 'desc' ? -1 : 1;
    }
    return 0;
  });
}

/** Suggested defaults for newly-created binders. */
export const NEW_BINDER_DEFAULT_SORTS: SortEntry[] = [{ field: 'color', dir: 'asc' }];

/** Maximum number of sort fields a binder can chain. */
export const MAX_SORTS = 3;

const SORT_LABEL: Record<SortField, string> = SORT_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.label }),
  {} as Record<SortField, string>
);

const SORT_DEFAULT_DIR: Record<SortField, 'asc' | 'desc'> = SORT_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.defaultDir }),
  {} as Record<SortField, 'asc' | 'desc'>
);

export function sortEntryLabel(entry: SortEntry): string {
  const label = SORT_LABEL[entry.field] ?? entry.field;
  const isNonDefault = entry.dir !== (SORT_DEFAULT_DIR[entry.field] ?? 'asc');
  if (!isNonDefault) return label;
  return `${label} ${entry.dir === 'asc' ? '↑' : '↓'}`;
}
