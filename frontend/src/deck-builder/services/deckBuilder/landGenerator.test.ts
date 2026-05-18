import { describe, it, expect } from 'vitest';
import { countColorPips } from './landGenerator';
import type { ScryfallCard } from '@/deck-builder/types';

function sc(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

describe('countColorPips', () => {
  it('counts colored mana symbols, ignoring generic', () => {
    const pips = countColorPips([sc({ mana_cost: '{2}{G}{G}{U}' })]);
    expect(pips).toEqual({ G: 2, U: 1 });
  });

  it('counts every color in a hybrid symbol', () => {
    const pips = countColorPips([sc({ mana_cost: '{W/U}{2/R}{G/P}' })]);
    expect(pips).toEqual({ W: 1, U: 1, R: 1, G: 1 });
  });

  it('aggregates across both faces of a double-faced card', () => {
    const dfc = sc({
      mana_cost: undefined,
      card_faces: [
        { name: 'Front', type_line: 'Creature', mana_cost: '{B}{B}' },
        { name: 'Back', type_line: 'Creature', mana_cost: '{R}' },
      ],
    });
    expect(countColorPips([dfc])).toEqual({ B: 2, R: 1 });
  });

  it('returns an empty record for cards with no mana cost', () => {
    expect(countColorPips([sc({ mana_cost: undefined })])).toEqual({});
  });

  it('sums pips across the whole card list', () => {
    const pips = countColorPips([sc({ mana_cost: '{G}' }), sc({ mana_cost: '{G}{W}' })]);
    expect(pips).toEqual({ G: 2, W: 1 });
  });
});
