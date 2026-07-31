import { describe, expect, it } from 'vitest';
import {
  comboResultKinds,
  countActiveFilters,
  emptyComboFilters,
  filterCombos,
  pieceCountBucket,
  type ComboFilterState,
} from './combo-filters';
import type { ComboMatch } from '../types/combos';

function match(over: {
  id?: string;
  identity?: string;
  produces?: string[];
  names?: string[];
}): ComboMatch {
  const names = over.names ?? ['Card A', 'Card B'];
  return {
    combo: {
      id: over.id ?? 'c1',
      identity: over.identity ?? 'ub',
      produces: over.produces ?? ['Infinite mana'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 0,
      cardCount: names.length,
      bracket: null,
      bracketTag: null,
      cards: names.map((n, i) => ({ oracleId: `o${i}`, cardName: n, quantity: 1 })),
    },
    presentOracleIds: [],
    missingOracleIds: [],
  };
}

function filters(over: Partial<ComboFilterState> = {}): ComboFilterState {
  return { ...emptyComboFilters(), ...over };
}

describe('comboResultKinds', () => {
  it('buckets by keyword and allows several per combo', () => {
    expect([...comboResultKinds(['Infinite mana', 'Infinite damage'])].sort()).toEqual([
      'damage',
      'mana',
    ]);
  });

  it('files an explicit game-winning line as win', () => {
    expect(comboResultKinds(['Each opponent loses the game']).has('win')).toBe(true);
  });

  it('returns nothing for text it does not recognise', () => {
    expect(comboResultKinds(['Something unusual happens']).size).toBe(0);
  });
});

describe('pieceCountBucket', () => {
  it('maps counts to 2 / 3 / 4+', () => {
    expect(pieceCountBucket(2)).toBe('2');
    expect(pieceCountBucket(3)).toBe('3');
    expect(pieceCountBucket(4)).toBe('4+');
    expect(pieceCountBucket(7)).toBe('4+');
  });
});

describe('filterCombos', () => {
  const ub = match({ id: 'ub', identity: 'ub', produces: ['Infinite mana'] });
  const mono = match({ id: 'u', identity: 'u', produces: ['Infinite damage'] });
  const colorless = match({ id: 'c', identity: 'c', produces: ['Infinite tokens'] });
  const all = [ub, mono, colorless];

  it('returns everything when nothing is set', () => {
    expect(filterCombos(all, filters())).toHaveLength(3);
  });

  describe('colors', () => {
    it('keeps combos whose identity FITS INSIDE the selection, not merely overlaps', () => {
      // Picking U alone must not surface the UB combo — you couldn't run it.
      const ids = filterCombos(all, filters({ colors: new Set(['U']) })).map((m) => m.combo.id);
      expect(ids).toEqual(['u']);
    });

    it('surfaces the UB combo once both its colours are selected', () => {
      const ids = filterCombos(all, filters({ colors: new Set(['U', 'B']) })).map(
        (m) => m.combo.id
      );
      expect(ids).toEqual(['ub', 'u']);
    });

    it('treats C as an explicit colorless-only filter', () => {
      const ids = filterCombos(all, filters({ colors: new Set(['C']) })).map((m) => m.combo.id);
      expect(ids).toEqual(['c']);
    });
  });

  describe('search', () => {
    it('matches a card name', () => {
      const thassa = match({ id: 't', names: ["Thassa's Oracle", 'Demonic Consultation'] });
      expect(filterCombos([thassa, ub], filters(), { search: 'thassa' })).toHaveLength(1);
    });

    it('matches the result text', () => {
      expect(
        filterCombos(all, filters(), { search: 'infinite mana' }).map((m) => m.combo.id)
      ).toEqual(['ub']);
    });

    it('ignores surrounding whitespace and case', () => {
      expect(filterCombos(all, filters(), { search: '  INFINITE MANA ' })).toHaveLength(1);
    });
  });

  describe('results', () => {
    it('keeps a combo matching ANY selected result', () => {
      const ids = filterCombos(all, filters({ results: new Set(['mana', 'tokens']) })).map(
        (m) => m.combo.id
      );
      expect(ids).toEqual(['ub', 'c']);
    });
  });

  describe('piece count', () => {
    it('filters by bucket', () => {
      const three = match({ id: '3', names: ['A', 'B', 'C'] });
      const ids = filterCombos([ub, three], filters({ pieceCounts: new Set(['3']) })).map(
        (m) => m.combo.id
      );
      expect(ids).toEqual(['3']);
    });
  });

  describe('hostOnly', () => {
    it('drops combos the predicate rejects', () => {
      const out = filterCombos(all, filters({ hostOnly: true }), {
        canHost: (m) => m.combo.id === 'u',
      });
      expect(out.map((m) => m.combo.id)).toEqual(['u']);
    });

    it('is a no-op rather than an empty list when no predicate is supplied', () => {
      expect(filterCombos(all, filters({ hostOnly: true }))).toHaveLength(3);
    });
  });

  it('ANDs the filters together', () => {
    const out = filterCombos(all, filters({ colors: new Set(['U']), results: new Set(['mana']) }));
    // mono-U is the only colour match, but it produces damage, not mana.
    expect(out).toEqual([]);
  });
});

describe('countActiveFilters', () => {
  it('counts every set member plus the host toggle', () => {
    expect(countActiveFilters(emptyComboFilters())).toBe(0);
    expect(countActiveFilters(filters({ colors: new Set(['U', 'B']), hostOnly: true }))).toBe(3);
  });
});
