import { describe, expect, it } from 'vitest';
import { buildCoachChanges } from './coach-changes';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { CrossDeckMove } from './cross-deck-moves';

const gap = (name: string): GapAnalysisCard => ({
  name,
  price: '1.00',
  inclusion: 40,
  synergy: 10,
  typeLine: 'Instant',
});

describe('buildCoachChanges', () => {
  const owned = () => 'unowned' as const;

  it('drops adds already in the deck and cuts that already left', () => {
    const changes = buildCoachChanges(
      {
        gaps: [gap('Harrow'), gap('Farseek')],
        optimize: {
          additions: [],
          removals: [
            {
              name: 'Still Here',
              reason: 'Low synergy',
              reasonCategory: 'low-synergy',
              inclusion: 5,
            },
            { name: 'Gone', reason: 'Low synergy', reasonCategory: 'low-synergy', inclusion: 5 },
          ],
        },
        synergy: [],
        substitutes: [],
      },
      owned,
      new Set(['farseek', 'still here'])
    );
    expect(changes.map((c) => `${c.type}:${c.name}`)).toEqual(['add:Harrow', 'cut:Still Here']);
    expect(changes[0].deltaPrice).toBe(1);
  });

  it('shows a card sitting in a sibling deck once, as the move', () => {
    const move = {
      id: 'm1',
      cardName: 'Harrow',
      fromDeckName: 'Tatyova',
      replacementName: 'Explore',
    } as CrossDeckMove;
    const changes = buildCoachChanges(
      { gaps: [gap('Harrow')], synergy: [], substitutes: [], crossDeckMoves: [move] },
      owned,
      new Set()
    );
    expect(changes.map((c) => c.lane)).toEqual(['decks']);
  });
});
