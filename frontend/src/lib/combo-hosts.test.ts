import { describe, expect, it } from 'vitest';
import {
  commandersForIdentity,
  hasHostForIdentity,
  ownedCommanders,
  rankHosts,
} from './combo-hosts';
import type { EnrichedCard } from '../types';

function card(over: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    name: 'Kess, Dissident Mage',
    quantity: 1,
    purchasePrice: 0,
    typeLine: 'Legendary Creature — Human Wizard',
    oracleText: '',
    legalities: { commander: 'legal' },
    colorIdentity: ['U', 'B', 'R'],
    ...over,
  } as EnrichedCard;
}

describe('ownedCommanders', () => {
  it('keeps commander-eligible cards and drops the rest', () => {
    const result = ownedCommanders([
      card(),
      card({ name: 'Llanowar Elves', typeLine: 'Creature — Elf Druid' }),
    ]);
    expect(result.map((c) => c.name)).toEqual(['Kess, Dissident Mage']);
  });

  it('dedupes multiple copies of the same legend by name', () => {
    const result = ownedCommanders([
      card({ scryfallId: 'a' }),
      card({ scryfallId: 'b' }),
      card({ scryfallId: 'c' }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('drops legends that are banned in Commander', () => {
    expect(ownedCommanders([card({ legalities: { commander: 'banned' } })])).toEqual([]);
  });
});

describe('commandersForIdentity', () => {
  const kess = card(); // UBR
  const thrasios = card({ name: 'Thrasios', colorIdentity: ['G', 'U'] });
  const commanders = [kess, thrasios];

  it('keeps only commanders whose identity covers every colour the combo needs', () => {
    expect(commandersForIdentity(commanders, 'ub').map((c) => c.name)).toEqual([
      'Kess, Dissident Mage',
    ]);
  });

  it('treats a colorless combo as hostable by anyone', () => {
    expect(commandersForIdentity(commanders, 'c')).toHaveLength(2);
    expect(commandersForIdentity(commanders, '')).toHaveLength(2);
  });

  it('excludes a commander missing even one required colour', () => {
    // Thrasios is GU — a UBR combo needs B and R it doesn't have.
    expect(commandersForIdentity([thrasios], 'ubr')).toEqual([]);
  });

  it('treats an unrecorded colour identity as colorless rather than guessing a match', () => {
    const unknown = card({ name: 'Mystery Legend', colorIdentity: undefined });
    expect(commandersForIdentity([unknown], 'u')).toEqual([]);
    expect(commandersForIdentity([unknown], 'c')).toHaveLength(1);
  });
});

describe('hasHostForIdentity', () => {
  it('agrees with commandersForIdentity without building an array', () => {
    const kess = card(); // UBR
    const thrasios = card({ name: 'Thrasios', colorIdentity: ['G', 'U'] });
    expect(hasHostForIdentity([kess, thrasios], 'ub')).toBe(true);
    expect(hasHostForIdentity([thrasios], 'ubr')).toBe(false);
  });
});

describe('rankHosts', () => {
  it('ranks a more-played commander ahead of an alphabetically-earlier, unranked one', () => {
    // Both are mono-black (already filtered). Aardvark sorts first
    // alphabetically but has no recorded EDHREC rank; Zubaz is ranked and
    // must come first.
    const aardvark = card({
      name: 'Aardvark, Broad Ruler',
      colorIdentity: ['B'],
      edhrecRank: undefined,
    });
    const zubaz = card({ name: 'Zubaz, Grim Harvester', colorIdentity: ['B'], edhrecRank: 500 });
    expect(rankHosts([aardvark, zubaz]).map((c) => c.name)).toEqual([
      'Zubaz, Grim Harvester',
      'Aardvark, Broad Ruler',
    ]);
  });

  it('breaks an EDHREC-rank tie by tighter colour identity, not name', () => {
    const kess = card({ colorIdentity: ['U', 'B', 'R'], edhrecRank: 100 }); // Kess, Dissident Mage
    const aardvark = card({
      name: 'Aardvark, Broad Ruler',
      colorIdentity: ['W', 'U', 'B', 'R', 'G'],
      edhrecRank: 100,
    });
    expect(rankHosts([aardvark, kess]).map((c) => c.name)).toEqual([
      'Kess, Dissident Mage',
      'Aardvark, Broad Ruler',
    ]);
  });
});
