import { afterEach, describe, expect, it, vi } from 'vitest';
import { floorsAtFourAlone, estimateBracket } from './bracketEstimator';
import { getComboVotes, loadComboVotes, setComboVotesForTests } from './comboVotes';
import type { DetectedCombo } from '@/deck-builder/types';

const sanguine: DetectedCombo = {
  comboId: '690-3966',
  cards: ['Sanguine Bond', 'Exquisite Blood'],
  results: [],
  isComplete: true,
  missingCards: [],
  deckCount: 0,
  bracket: null,
  bracketTag: 'S',
  cardCount: 2,
};

const estimate = () =>
  estimateBracket(['Sanguine Bond', 'Exquisite Blood'], [sanguine], 3.4, undefined, {}, new Set());

afterEach(() => {
  setComboVotesForTests(undefined);
  vi.unstubAllGlobals();
});

describe('loadComboVotes', () => {
  it('feeds the community vote to the estimator once loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ early: ['690-3966'], late: [] }))
    );
    expect(estimate().bracket).toBe(3);
    expect(floorsAtFourAlone(sanguine)).toBe(false);
    await loadComboVotes();
    expect(getComboVotes()?.get('690-3966')).toBe('early');
    expect(estimate().bracket).toBe(4);
    expect(floorsAtFourAlone(sanguine)).toBe(true);
  });

  it('leaves every combo unvoted when the snapshot is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    );
    await expect(loadComboVotes()).resolves.toBeUndefined();
    expect(getComboVotes()).toBeUndefined();
    expect(estimate().bracket).toBe(3);
  });
});
