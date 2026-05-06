import type { EnrichedCard, SortField } from '../types';
import { COLOR_INFO, COLOR_ORDER, getColorKey } from './colors';
import { TYPE_ORDER, getCardType } from './card-types';

/**
 * Metadata for a top-level binder section. The primary sort field drives
 * grouping — color produces White/Blue/…, type produces Creature/Instant/…,
 * cmc produces 0/1/2/…, etc. `order` orders sections within the binder.
 */
export interface SectionMeta {
  key: string;
  label: string;
  order: number;
  /** Color-pip styling, populated only when grouping by color. */
  pip?: { background: string; border: string };
}

const RARITY_INFO: Record<string, { label: string; order: number }> = {
  mythic: { label: 'Mythic', order: 0 },
  rare: { label: 'Rare', order: 1 },
  uncommon: { label: 'Uncommon', order: 2 },
  common: { label: 'Common', order: 3 },
  special: { label: 'Special', order: 4 },
  bonus: { label: 'Bonus', order: 5 },
};

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function cmcBucket(cmc: number | undefined): SectionMeta {
  if (cmc === undefined || cmc === null || Number.isNaN(cmc)) {
    return { key: 'cmc-?', label: 'Unknown CMC', order: 999 };
  }
  if (cmc >= 7) return { key: 'cmc-7+', label: 'CMC 7+', order: 7 };
  return { key: `cmc-${cmc}`, label: `CMC ${cmc}`, order: cmc };
}

function priceBucket(p: number): SectionMeta {
  if (!p || p <= 0) return { key: 'price-0', label: '$0', order: 0 };
  if (p < 1) return { key: 'price-lt1', label: '< $1', order: 1 };
  if (p < 5) return { key: 'price-1-5', label: '$1 – $5', order: 2 };
  if (p < 20) return { key: 'price-5-20', label: '$5 – $20', order: 3 };
  return { key: 'price-20+', label: '$20+', order: 4 };
}

function edhrecBucket(rank: number | undefined): SectionMeta {
  if (rank === undefined) return { key: 'edhrec-none', label: 'Unranked', order: 99 };
  if (rank <= 100) return { key: 'edhrec-100', label: 'Top 100', order: 0 };
  if (rank <= 1000) return { key: 'edhrec-1000', label: 'Top 1,000', order: 1 };
  if (rank <= 10000) return { key: 'edhrec-10k', label: 'Top 10,000', order: 2 };
  return { key: 'edhrec-rest', label: '10,000+', order: 3 };
}

function nameBucket(name: string): SectionMeta {
  const first = (name?.[0] || '').toUpperCase();
  if (first >= 'A' && first <= 'Z') {
    return { key: `name-${first}`, label: first, order: first.charCodeAt(0) };
  }
  return { key: 'name-#', label: '#', order: 0 };
}

export function getSectionMeta(card: EnrichedCard, field: SortField): SectionMeta {
  switch (field) {
    case 'color': {
      const k = getColorKey(card);
      const info = COLOR_INFO[k];
      const idx = COLOR_ORDER.indexOf(k);
      return {
        key: k,
        label: info?.label ?? k,
        order: idx === -1 ? 100 : idx,
        pip: info ? { background: info.pip, border: info.border } : undefined,
      };
    }
    case 'type': {
      const k = getCardType(card);
      const idx = TYPE_ORDER.indexOf(k);
      return { key: k, label: capitalize(k), order: idx === -1 ? 99 : idx };
    }
    case 'rarity': {
      const k = (card.rarity || 'common').toLowerCase();
      const info = RARITY_INFO[k] ?? { label: capitalize(k), order: 9 };
      return { key: k, label: info.label, order: info.order };
    }
    case 'cmc':
      return cmcBucket(card.cmc);
    case 'set':
      return {
        key: card.setCode || 'unknown',
        label: card.setName || card.setCode || 'Unknown set',
        order: 0,
      };
    case 'name':
      return nameBucket(card.name);
    case 'price':
      return priceBucket(card.purchasePrice);
    case 'edhrec':
      return edhrecBucket(card.edhrecRank);
    default:
      return { key: 'ALL', label: 'All cards', order: 0 };
  }
}

export const ALL_SECTION: SectionMeta = { key: 'ALL', label: 'All cards', order: 0 };
