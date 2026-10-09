import { describe, it, expect } from 'vitest';
import { carryForward, assertNoShrink } from './sld-drop-merge.mjs';

const prev = [
  { name: 'Drop A', releasedAt: '2021-01-01', numbers: ['1', '2', '3', '501'] },
  { name: 'Drop B', releasedAt: '2020-01-01', numbers: ['10', '11'] },
];

describe('carryForward', () => {
  it('keeps a drop whose explicit numbers upstream stopped listing', () => {
    // Upstream now writes Drop A's bonus card (501) as a pack code, and Drop B
    // entirely so: it is absent from the build.
    const built = [{ name: 'Drop A', releasedAt: '2021-01-02', numbers: ['1', '2', '3'] }];
    const { drops, carried } = carryForward(built, prev);
    expect(drops.find((d) => d.name === 'Drop A').numbers).toEqual(['1', '2', '3', '501']);
    expect(drops.find((d) => d.name === 'Drop B').numbers).toEqual(['10', '11']);
    expect(carried).toEqual([
      { drop: 'Drop A', number: '501' },
      { drop: 'Drop B', number: '10' },
      { drop: 'Drop B', number: '11' },
    ]);
  });

  it('takes the new date and adds new drops', () => {
    const built = [
      { name: 'Drop A', releasedAt: '2021-01-02', numbers: ['1', '2', '3', '501'] },
      { name: 'Drop C', releasedAt: '2022-05-05', numbers: ['20'] },
    ];
    const { drops, carried } = carryForward(built, prev);
    expect(drops.map((d) => d.name)).toEqual(['Drop C', 'Drop A', 'Drop B']);
    expect(drops.find((d) => d.name === 'Drop A').releasedAt).toBe('2021-01-02');
    expect(carried.filter((c) => c.drop === 'Drop A')).toEqual([]);
  });

  it('works with no previous snapshot', () => {
    const built = [{ name: 'Drop C', releasedAt: '2022-05-05', numbers: ['20'] }];
    expect(carryForward(built, null)).toEqual({ drops: built, carried: [] });
  });
});

describe('assertNoShrink', () => {
  const big = [
    {
      name: 'Big',
      releasedAt: '2021-01-01',
      numbers: Array.from({ length: 100 }, (_, i) => `${i}`),
    },
  ];

  it('throws when a refresh loses 30% of the pairs', () => {
    const next = [{ ...big[0], numbers: big[0].numbers.slice(0, 70) }];
    expect(() => assertNoShrink(next, big)).toThrow(/lost 30 of 100/);
  });

  it('tolerates small churn and growth', () => {
    const next = [{ ...big[0], numbers: [...big[0].numbers.slice(1), '999'] }];
    expect(assertNoShrink(next, big).lost).toHaveLength(1);
  });

  it('passes on a first run', () => {
    expect(assertNoShrink(big, null)).toEqual({ before: 0, lost: [] });
  });
});
