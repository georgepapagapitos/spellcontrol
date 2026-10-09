import { describe, it, expect } from 'vitest';
import { assertNoShrink } from './sld-drop-merge.mjs';

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
