import { describe, it, expect } from 'vitest';
import { getSectionMeta, ALL_SECTION } from './sections';
import type { EnrichedCard, SortField } from '../types';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'c1',
    name: 'Alpha',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'a',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

describe('getSectionMeta', () => {
  it('groups by color with pip metadata', () => {
    const meta = getSectionMeta(card({ colorIdentity: ['G'], typeLine: 'Creature' }), 'color');
    expect(meta.key).toBe('G');
    expect(meta.pip).toBeDefined();
  });

  it('groups by type using TYPE_ORDER', () => {
    const meta = getSectionMeta(card({ typeLine: 'Instant' }), 'type');
    expect(meta.label).toBe('Instant');
  });

  it('rarity uses canonical labels and unknown rarities fall back', () => {
    expect(getSectionMeta(card({ rarity: 'mythic' }), 'rarity').label).toBe('Mythic');
    expect(getSectionMeta(card({ rarity: 'rare' }), 'rarity').order).toBe(1);
    expect(getSectionMeta(card({ rarity: 'foobar' }), 'rarity').label).toBe('Foobar');
  });

  it('cmc bucket caps at 7+', () => {
    expect(getSectionMeta(card({ cmc: 0 }), 'cmc').label).toBe('CMC 0');
    expect(getSectionMeta(card({ cmc: 6 }), 'cmc').label).toBe('CMC 6');
    expect(getSectionMeta(card({ cmc: 7 }), 'cmc').label).toBe('CMC 7+');
    expect(getSectionMeta(card({ cmc: 99 }), 'cmc').key).toBe('cmc-7+');
    expect(getSectionMeta(card({ cmc: undefined }), 'cmc').label).toBe('Unknown CMC');
  });

  it('setReleaseDate bucket uses set name and code and orders by release', () => {
    const meta = getSectionMeta(
      card({ setCode: 'CMM', setName: 'Commander Masters' }),
      'setReleaseDate',
      {
        setMap: {
          CMM: { code: 'CMM', name: 'Commander Masters', iconSvgUri: '', releasedAt: '2023-08-04' },
        },
      }
    );
    expect(meta.key).toBe('CMM');
    expect(meta.label).toBe('Commander Masters');
    expect(meta.order).toBe(new Date('2023-08-04').getTime());
  });

  it('setName bucket sorts alphabetically (order=0, label tiebreak)', () => {
    const meta = getSectionMeta(card({ setCode: 'CMM', setName: 'Commander Masters' }), 'setName');
    expect(meta.key).toBe('CMM');
    expect(meta.label).toBe('Commander Masters');
    expect(meta.order).toBe(0);
  });

  it('name bucket uses first letter, # for non-letters', () => {
    expect(getSectionMeta(card({ name: 'arcane' }), 'name').key).toBe('name-A');
    expect(getSectionMeta(card({ name: '7th Edition' }), 'name').key).toBe('name-#');
    expect(getSectionMeta(card({ name: '' }), 'name').key).toBe('name-#');
  });

  it('price buckets cover the standard ranges', () => {
    expect(getSectionMeta(card({ purchasePrice: 0 }), 'price').key).toBe('price-0');
    expect(getSectionMeta(card({ purchasePrice: 0.5 }), 'price').key).toBe('price-lt1');
    expect(getSectionMeta(card({ purchasePrice: 3 }), 'price').key).toBe('price-1-5');
    expect(getSectionMeta(card({ purchasePrice: 12 }), 'price').key).toBe('price-5-20');
    expect(getSectionMeta(card({ purchasePrice: 100 }), 'price').key).toBe('price-20+');
  });

  it('edhrec buckets cover the standard ranges', () => {
    expect(getSectionMeta(card({ edhrecRank: 50 }), 'edhrec').key).toBe('edhrec-100');
    expect(getSectionMeta(card({ edhrecRank: 500 }), 'edhrec').key).toBe('edhrec-1000');
    expect(getSectionMeta(card({ edhrecRank: 5000 }), 'edhrec').key).toBe('edhrec-10k');
    expect(getSectionMeta(card({ edhrecRank: 50000 }), 'edhrec').key).toBe('edhrec-rest');
    expect(getSectionMeta(card({ edhrecRank: undefined }), 'edhrec').key).toBe('edhrec-none');
  });

  it('falls back to ALL for unknown sort fields', () => {
    expect(getSectionMeta(card({}), 'none' as SortField).key).toBe('ALL');
  });

  it('exposes ALL_SECTION constant', () => {
    expect(ALL_SECTION.key).toBe('ALL');
  });
});
