import { describe, expect, it } from 'vitest';
import { collectGroupNames } from './deck-tags';

describe('collectGroupNames', () => {
  it('lists the user tags and the groups Suggest groups filed, once each', () => {
    const names = collectGroupNames({
      cards: [
        { tags: ['Ramp'] },
        { tags: undefined, stack: 'Card Draw' },
        { tags: undefined, stack: 'ramp' },
        { tags: undefined },
      ],
      sideboard: [{ tags: ['Tech'] }],
    });
    expect(names).toEqual(['Card Draw', 'Ramp', 'Tech']);
  });

  it('ignores a suggested group on a slot the user has since tagged or cleared', () => {
    expect(
      collectGroupNames({
        cards: [
          { tags: [], stack: 'Lands' },
          { tags: ['Combo'], stack: 'Removal' },
        ],
      })
    ).toEqual(['Combo']);
  });
});
