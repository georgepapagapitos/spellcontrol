import { describe, it, expect, beforeEach } from 'vitest';
import { useConflictsStore, conflictQueue, type DeckConflict } from './conflicts';
import type { Deck } from './decks';

const deck = (id: string, name: string): Deck => ({ id, name }) as unknown as Deck;

const makeConflict = (id: string): DeckConflict => ({
  id,
  localDeck: deck(id, 'mine'),
  serverDeck: deck(id, 'theirs'),
  detectedAt: 0,
});

beforeEach(() => {
  useConflictsStore.setState({ queue: [] });
});

describe('useConflictsStore', () => {
  it('starts empty', () => {
    expect(useConflictsStore.getState().queue).toEqual([]);
  });

  it('push appends conflicts, preserving order', () => {
    useConflictsStore.getState().push([makeConflict('d-1'), makeConflict('d-2')]);
    expect(useConflictsStore.getState().queue.map((c) => c.id)).toEqual(['d-1', 'd-2']);
  });

  it('push replaces an already-queued conflict for the same deck instead of stacking a duplicate', () => {
    useConflictsStore.getState().push([makeConflict('d-1')]);
    const retried: DeckConflict = { ...makeConflict('d-1'), detectedAt: 99 };
    useConflictsStore.getState().push([retried]);
    const queue = useConflictsStore.getState().queue;
    expect(queue).toHaveLength(1);
    expect(queue[0].detectedAt).toBe(99);
  });

  it('dismiss removes only the matching conflict', () => {
    useConflictsStore.getState().push([makeConflict('d-1'), makeConflict('d-2')]);
    useConflictsStore.getState().dismiss('d-1');
    expect(useConflictsStore.getState().queue.map((c) => c.id)).toEqual(['d-2']);
  });

  it('clear empties the queue', () => {
    useConflictsStore.getState().push([makeConflict('d-1')]);
    useConflictsStore.getState().clear();
    expect(useConflictsStore.getState().queue).toEqual([]);
  });

  it('conflictQueue.push is the imperative equivalent of the store action', () => {
    conflictQueue.push([makeConflict('d-1')]);
    expect(useConflictsStore.getState().queue.map((c) => c.id)).toEqual(['d-1']);
  });
});
