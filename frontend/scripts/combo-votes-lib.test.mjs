import { describe, it, expect } from 'vitest';
import { MIN_VOTES, isUsableVote, pickVotes } from './combo-votes-lib.mjs';

const entry = (comboId, vote, cardIds = [1, 2]) => ({
  combo: {
    comboId,
    cardIds,
    comboVote: { bracket: '4-5', voteCount: 16, controversial: false, ...vote },
  },
});

describe('isUsableVote', () => {
  it('takes a settled early vote', () => {
    expect(isUsableVote(entry('690-3966', {}), 'early')).toBe(true);
  });

  it('refuses a thin tail under the vote floor', () => {
    expect(isUsableVote(entry('1-2', { voteCount: MIN_VOTES - 1 }), 'early')).toBe(false);
    expect(isUsableVote(entry('1-2', { voteCount: MIN_VOTES }), 'early')).toBe(true);
  });

  it('refuses a split vote', () => {
    expect(isUsableVote(entry('1-2', { controversial: true }), 'early')).toBe(false);
  });

  it('refuses a bracket label that disagrees with the list', () => {
    expect(isUsableVote(entry('1-2', { bracket: '3' }), 'early')).toBe(false);
    expect(isUsableVote(entry('1-2', { bracket: '3' }), 'late')).toBe(true);
    expect(isUsableVote(entry('1-2', { bracket: '4-5' }), 'late')).toBe(false);
  });

  it('refuses anything but a two-card combo, and entries with no vote', () => {
    expect(isUsableVote(entry('1-2-3', {}, [1, 2, 3]), 'early')).toBe(false);
    expect(isUsableVote({ combo: { comboId: '1-2', cardIds: [1, 2] } }, 'early')).toBe(false);
    expect(isUsableVote(null, 'early')).toBe(false);
  });
});

describe('pickVotes', () => {
  it('returns sorted unique ids per list and drops an id on both', () => {
    const out = pickVotes({
      early: [entry('9-9', {}), entry('1-2', {}), entry('1-2', {}), entry('5-5', {})],
      late: [entry('7-7', { bracket: '3' }), entry('5-5', { bracket: '3' })],
    });
    expect(out).toEqual({ early: ['1-2', '9-9'], late: ['7-7'] });
  });
});
