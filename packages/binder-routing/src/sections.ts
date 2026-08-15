import type { EnrichedCard, SetMap, SortField } from './types.js';
import { COLOR_INFO, COLOR_ORDER, getColorKey } from './colors.js';
import { TYPE_ORDER, getCardType } from './card-types.js';
import { releaseDateOf } from './sorting.js';

export interface SectionContext {
  setMap?: SetMap;
}

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

/**
 * `order` for a group whose sort value is unknown — a set with no release date,
 * a Secret Lair number MTGJSON hasn't mapped, a card with no mana value or no
 * EDHREC rank. Section ordering keeps these last whatever the direction:
 * "newest first" leading with the cards whose date we don't know is never what
 * was asked for. The card-side twin is `UNKNOWN_VALUE` in sorting.ts.
 */
export const UNKNOWN_ORDER = Number.MAX_SAFE_INTEGER;

const RARITY_INFO: Record<string, { label: string; order: number }> = {
  mythic: { label: 'Mythic', order: 0 },
  rare: { label: 'Rare', order: 1 },
  uncommon: { label: 'Uncommon', order: 2 },
  common: { label: 'Common', order: 3 },
  special: { label: 'Special', order: 4 },
  bonus: { label: 'Bonus', order: 5 },
};

/**
 * Set identity for the two set-driven groupings. A Secret Lair printing reports
 * its *drop* — Scryfall files all ~2,300 of them under one flat `SLD` set, so
 * grouping by the set code alone gives one useless "Secret Lair Drop" bucket
 * while the drop is the thing you actually bought and sleeve together. Numbers
 * MTGJSON doesn't cover keep the flat set name (see EnrichedCard.sldDrop).
 */
function setMeta(card: EnrichedCard): { key: string; label: string } {
  if (card.sldDrop) return { key: `sld-${card.sldDrop}`, label: card.sldDrop };
  return {
    key: card.setCode || 'unknown',
    label: card.setName || card.setCode || 'Unknown set',
  };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function cmcBucket(cmc: number | undefined): SectionMeta {
  if (cmc === undefined || cmc === null || Number.isNaN(cmc)) {
    return { key: 'cmc-?', label: 'Unknown CMC', order: UNKNOWN_ORDER };
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
  if (rank === undefined) return { key: 'edhrec-none', label: 'Unranked', order: UNKNOWN_ORDER };
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

export function getSectionMeta(
  card: EnrichedCard,
  field: SortField,
  ctx?: SectionContext
): SectionMeta {
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
    case 'setReleaseDate': {
      // `releaseDateOf` is the single source of a printing's date, so a section's
      // position and its cards' order can't disagree. Unknown sorts last in BOTH
      // directions — see UNKNOWN_ORDER.
      const released = releaseDateOf(card, ctx?.setMap);
      return {
        ...setMeta(card),
        order: released ? new Date(released).getTime() : UNKNOWN_ORDER,
      };
    }
    case 'setName':
      return { ...setMeta(card), order: 0 };
    case 'name':
      return nameBucket(card.name);
    case 'price':
      return priceBucket(card.purchasePrice);
    case 'edhrec':
      return edhrecBucket(card.edhrecRank);
    case 'collectorNumber':
    case 'quantity':
    default:
      return { key: 'ALL', label: 'All cards', order: 0 };
  }
}

export const ALL_SECTION: SectionMeta = { key: 'ALL', label: 'All cards', order: 0 };
