import { describe, expect, it } from 'vitest';
import { findBannedCards, HORDE_BAN_LIST } from './ban-list';

describe('findBannedCards', () => {
  it('flags a banned card by seat, case-insensitively', () => {
    const warnings = findBannedCards([
      { name: 'Alice', cardNames: ['Sol Ring', 'rest in peace'] },
      { name: 'Bo', cardNames: ['Lightning Bolt'] },
    ]);
    expect(warnings).toEqual([{ seatName: 'Alice', cardName: 'rest in peace' }]);
  });

  it('never blocks — an empty seat (no deck yet) is silent', () => {
    expect(findBannedCards([{ name: 'Alice', cardNames: [] }])).toEqual([]);
  });

  it('flags every banned card in a seat, not just the first', () => {
    const [a, b] = HORDE_BAN_LIST;
    const warnings = findBannedCards([{ name: 'Alice', cardNames: [a, 'Sol Ring', b] }]);
    expect(warnings.map((w) => w.cardName)).toEqual([a, b]);
  });

  it('is clean for a deck with nothing on the list', () => {
    expect(findBannedCards([{ name: 'Alice', cardNames: ['Sol Ring', 'Arcane Signet'] }])).toEqual(
      []
    );
  });
});
