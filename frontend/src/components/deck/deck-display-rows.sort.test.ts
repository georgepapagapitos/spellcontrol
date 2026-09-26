import { describe, expect, it } from 'vitest';
import { sortRows, type Row } from './deck-display-rows';

// sortRows reads only name / cmc / card here; the rest of Row is irrelevant.
const row = (name: string, cmc: number | undefined) =>
  ({ name, cmc: cmc ?? 0, card: { name, cmc } }) as unknown as Row;

describe('sortRows by mana value', () => {
  it('puts a card with no mana value last in both directions, like every other Mana value sort', () => {
    const rows = [row('Unknown', undefined), row('Three', 3), row('One', 1)];
    expect(sortRows(rows, 'cmc', 'asc').map((r) => r.name)).toEqual(['One', 'Three', 'Unknown']);
    expect(sortRows(rows, 'cmc', 'desc').map((r) => r.name)).toEqual(['Three', 'One', 'Unknown']);
  });
});
