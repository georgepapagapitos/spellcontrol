import { describe, expect, it } from 'vitest';
import { diffGameChangers, GAME_CHANGERS_AS_OF, HARDCODED_GAME_CHANGERS } from './index';

describe('diffGameChangers', () => {
  it('reports nothing when the live list is the hardcoded list', () => {
    expect(diffGameChangers([...HARDCODED_GAME_CHANGERS])).toEqual({ added: [], removed: [] });
  });

  it('reads a double-faced card by its front face on either side', () => {
    const live = ["Tergrid, God of Fright // Tergrid's Lantern"];
    expect(diffGameChangers(live, ['Tergrid, God of Fright'])).toEqual({ added: [], removed: [] });
    expect(diffGameChangers(['Tergrid, God of Fright'], live)).toEqual({ added: [], removed: [] });
  });

  it('names the added and the removed cards, sorted', () => {
    const live = ['Zeta Card', 'Alpha Card', 'Kept'];
    const known = ['Kept', 'Old Two', 'Old One'];
    expect(diffGameChangers(live, known)).toEqual({
      added: ['Alpha Card', 'Zeta Card'],
      removed: ['Old One', 'Old Two'],
    });
  });

  it('catches a single card dropped from the live list', () => {
    const live = [...HARDCODED_GAME_CHANGERS].filter((n) => n !== 'Mana Vault');
    expect(diffGameChangers(live)).toEqual({ added: [], removed: ['Mana Vault'] });
  });
});

describe('GAME_CHANGERS_AS_OF', () => {
  it('is an ISO date', () => {
    expect(GAME_CHANGERS_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
