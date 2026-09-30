import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cluesFor } from './clues';
import { attrsOf, findCard, getAnswerPool, nameKey, setDailyDataDir } from './data';
import { poolCard, writeDailyFixture } from './fixture';
import { addGuess, buildResponse, PlayError, statusOf } from './play';

beforeAll(() => setDailyDataDir(writeDailyFixture()));
afterAll(() => setDailyDataDir(null));

describe('card lookup', () => {
  it('ignores case, accents and spacing', () => {
    expect(nameKey("  Lim-Dûl's   Vault ")).toBe("lim-dul's vault");
    expect(findCard("lim-dul's VAULT")?.name).toBe("Lim-Dûl's Vault");
  });

  it('matches either face of a split card and returns the full name', () => {
    expect(findCard('wear')?.name).toBe('Wear // Tear');
    expect(findCard('TEAR')?.name).toBe('Wear // Tear');
    expect(findCard('Wear // Tear')?.name).toBe('Wear // Tear');
  });

  it('returns null for an unknown name', () => {
    expect(findCard('Not A Real Card')).toBeNull();
  });

  it('loads the pool and turns an entry into attributes', () => {
    expect(getAnswerPool()).toHaveLength(4);
    expect(attrsOf(poolCard('Sol Ring'))).toMatchObject({ name: 'Sol Ring', colors: '', mv: 1 });
  });
});

describe('clues', () => {
  it('lists six in order with a flavor clue when the card has flavor', () => {
    const c = cluesFor(poolCard('Swords to Plowshares'));
    expect(c.map((x) => x.label)).toEqual([
      'Mana value',
      'Colors',
      'Type',
      'First printed',
      'Rules text',
      'Flavor text',
    ]);
    expect(c[0]).toEqual({ label: 'Mana value', value: '1' });
    expect(c[1]!.value).toBe('White');
    expect(c[3]!.value).toBe('Test Set · 1993');
    expect(c[4]!.prose).toBe(true);
  });

  it('falls back to the first letter and says Colorless', () => {
    const c = cluesFor(poolCard('Sol Ring'));
    expect(c[1]!.value).toBe('Colorless');
    expect(c[5]).toEqual({ label: 'First letter', value: 'S' });
  });

  it('joins several colors', () => {
    expect(cluesFor({ ...poolCard('Counterspell'), colors: 'WU' })[1]!.value).toBe('White, Blue');
  });
});

describe('play state', () => {
  const answer = 'Sol Ring';

  it('rejects unknown, repeat and post-finish guesses', () => {
    const s0 = { guesses: [], gaveUp: false };
    expect(() => addGuess(s0, 'nope', answer)).toThrow(PlayError);
    expect(() => addGuess(s0, 42, answer)).toThrow('No card by that name');
    const s1 = addGuess(s0, 'lightning bolt', answer);
    expect(s1.guesses).toEqual(['Lightning Bolt']);
    expect(() => addGuess(s1, 'LIGHTNING BOLT', answer)).toThrow(
      "You've already guessed Lightning Bolt."
    );
    const solved = addGuess(s1, 'sol ring', answer);
    expect(statusOf(solved, answer)).toBe('solved');
    expect(() => addGuess(solved, 'Counterspell', answer)).toThrow(
      "Today's card is already finished."
    );
  });

  it('fails after six misses or a give-up', () => {
    expect(statusOf({ guesses: ['a', 'b', 'c', 'd', 'e', 'f'], gaveUp: false }, answer)).toBe(
      'failed'
    );
    expect(statusOf({ guesses: [], gaveUp: true }, answer)).toBe('failed');
  });

  it('builds a response that unlocks clues with each miss', () => {
    const puzzle = { date: '2026-10-01', number: 2, name: answer, payload: poolCard(answer) };
    const r = buildResponse(puzzle, { guesses: ['Lightning Bolt', 'Counterspell'], gaveUp: false });
    expect(r.status).toBe('playing');
    expect(r.clues).toHaveLength(3);
    expect(r.artLevel).toBe(2);
    expect(r.answer).toBeNull();
    expect(r.guesses[0]!.cells.type).toEqual({ value: 'Instant', mark: 'miss' });
    const done = buildResponse(puzzle, { guesses: [], gaveUp: true });
    expect(done.clues).toHaveLength(6);
    expect(done.artLevel).toBeNull();
    expect(done.answer?.name).toBe(answer);
  });
});
