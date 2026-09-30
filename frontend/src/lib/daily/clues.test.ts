import { describe, it, expect } from 'vitest';
import { cluesFor } from './clues';
import type { DailyPuzzle } from './schedule';

const base: DailyPuzzle = {
  date: '2026-10-03',
  number: 3,
  name: 'Swords to Plowshares',
  colors: 'W',
  mv: 1,
  typeLine: 'Instant',
  rarity: 'uncommon',
  year: 1993,
  setName: 'Limited Edition Alpha',
  rulesText: 'Exile target creature.',
  flavor: '',
  art: '',
};

describe('cluesFor', () => {
  it('lists six clues in unlock order, ending on the first letter when there is no flavour', () => {
    expect(cluesFor(base).map((c) => [c.label, c.value])).toEqual([
      ['Mana value', '1'],
      ['Colours', 'White'],
      ['Type', 'Instant'],
      ['First printed', 'Limited Edition Alpha · 1993'],
      ['Rules text', 'Exile target creature.'],
      ['First letter', 'S'],
    ]);
  });

  it('uses flavour text as the sixth clue when the card has some', () => {
    const last = cluesFor({ ...base, flavor: 'The blade gleams.' }).at(-1);
    expect(last).toEqual({ label: 'Flavour text', value: 'The blade gleams.', prose: true });
  });

  it('names every colour, and says colourless for none', () => {
    expect(cluesFor({ ...base, colors: 'WUG' })[1]?.value).toBe('White, Blue, Green');
    expect(cluesFor({ ...base, colors: '' })[1]?.value).toBe('Colourless');
  });
});
