import { describe, expect, it } from 'vitest';
import { deckPickerMeta } from './compare-picker-meta';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const deck = (id: string, name: string, cards: number, updatedAt: number) => ({
  id,
  name,
  cards: Array.from({ length: cards }),
  updatedAt,
});

describe('deckPickerMeta', () => {
  it('keeps the short relative form when rows already differ', () => {
    const m = deckPickerMeta(
      [deck('a', 'Abigale', 99, NOW - 3 * DAY), deck('b', 'Abigale', 60, NOW - 40 * DAY)],
      NOW
    );
    expect(m.get('a')).toBe('99 cards · Edited 3d ago');
    expect(m.get('b')).toMatch(/^60 cards · Edited .*ago$/);
  });

  it('gives same-name, same-size, same-day decks distinct absolute timestamps (E322)', () => {
    const m = deckPickerMeta(
      [
        deck('a', 'Thassa', 99, NOW - 3 * DAY),
        deck('b', 'Thassa', 99, NOW - 3 * DAY - 2 * HOUR),
        deck('c', 'Thassa', 99, NOW - 3 * DAY - 5 * HOUR),
      ],
      NOW
    );
    const lines = ['a', 'b', 'c'].map((id) => m.get(id)!);
    expect(new Set(lines).size).toBe(3);
    for (const l of lines) expect(l).not.toMatch(/ago$/);
  });

  it('only the tied rows switch; a differently named deck keeps its relative line', () => {
    const m = deckPickerMeta(
      [
        deck('a', 'Thassa', 99, NOW - 3 * DAY),
        deck('b', 'Thassa', 99, NOW - 3 * DAY - HOUR),
        deck('c', 'Krenko', 99, NOW - 3 * DAY),
      ],
      NOW
    );
    expect(m.get('a')).not.toMatch(/ago$/);
    expect(m.get('c')).toBe('99 cards · Edited 3d ago');
  });
});
