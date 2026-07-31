import { describe, expect, it } from 'vitest';
import { commandersForIdentity, ownedCommanders } from './combo-hosts';
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

  it('ranks a tighter colour-identity match ahead of an alphabetically-earlier loose one', () => {
    // Both trivially host a UB combo. Aardvark is 5-colour and alphabetically
    // first; Kess is UBR (3-colour, tighter). Kess must rank first.
    const aardvark = card({
      name: 'Aardvark, Broad Ruler',
      colorIdentity: ['W', 'U', 'B', 'R', 'G'],
    });
    const result = commandersForIdentity([aardvark, kess], 'ub');
    expect(result.map((c) => c.name)).toEqual(['Kess, Dissident Mage', 'Aardvark, Broad Ruler']);
  });
});
