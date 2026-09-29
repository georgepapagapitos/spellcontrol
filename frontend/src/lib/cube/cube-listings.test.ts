import { describe, expect, it } from 'vitest';
import { buildCubeListings } from './cube-listings';
import type { SavedCube, CubePickSlot } from '@/store/cube';
import type { GeneratedCube } from './generate';

const pick = (name: string) => ({
  card: { name, oracleId: name, colors: [], cmc: 0, typeLine: '', role: null },
  bucket: 'colorless' as const,
  reason: '',
});

function cube(
  id: string,
  names: string[],
  over: Partial<SavedCube> = {},
  legends: string[] = []
): SavedCube {
  return {
    id,
    name: `Cube ${id}`,
    size: 360,
    cube: {
      picks: names.map(pick),
      ...(legends.length ? { legends: legends.map(pick) } : {}),
    } as unknown as GeneratedCube,
    picks: [],
    isPhysical: false,
    savedAt: 0,
    ...over,
  };
}

const slot = (name: string, copyId: string | null): CubePickSlot => ({
  slotId: name,
  card: pick(name).card,
  allocatedCopyId: copyId,
  printingFinishKey: null,
});

describe('buildCubeListings', () => {
  it('a draft cube lists every card, keyed case-insensitively', () => {
    const m = buildCubeListings([cube('a', ['Sol Ring', 'Swords to Plowshares'])]);
    expect(m.get('sol ring')).toEqual([{ cubeId: 'a', cubeName: 'Cube a' }]);
    expect(m.get('swords to plowshares')).toHaveLength(1);
  });

  it('a physical cube lists only what it holds no copy of, plus its commanders', () => {
    // The reserved pick is already the claim-based cube badge; listing it too
    // would draw two cube badges for one cube on the same card.
    const physical = cube(
      'p',
      ['Sol Ring', 'Mana Crypt'],
      { isPhysical: true, picks: [slot('Sol Ring', 'copy-1'), slot('Mana Crypt', null)] },
      ['Atraxa']
    );
    const m = buildCubeListings([physical]);
    expect(m.has('sol ring')).toBe(false);
    expect(m.get('mana crypt')?.[0].cubeId).toBe('p');
    expect(m.get('atraxa')?.[0].cubeId).toBe('p');
  });

  it('a card in two cubes lists both, once each', () => {
    const m = buildCubeListings([cube('a', ['Sol Ring', 'Sol Ring']), cube('b', ['Sol Ring'])]);
    expect(m.get('sol ring')?.map((l) => l.cubeId)).toEqual(['a', 'b']);
  });
});
