import { describe, expect, it } from 'vitest';
import { resolveHordeSettings } from '@/lib/horde';
import { createPlaytestState } from '@/lib/playtest';
import {
  hordeArrivesAfterTurn,
  hordeCreatureIds,
  isHordeTurnDue,
  type SoloHordeState,
} from './horde-solo';

function horde(
  setupTurns: number,
  armedAtTurn: number,
  phase: SoloHordeState['phase'] = 'waiting'
) {
  const settings = { ...resolveHordeSettings('standard', 1), setupTurns };
  return {
    armedAtTurn,
    phase,
    config: {
      hordeId: 'zombies',
      hordeName: 'Zombies',
      level: 'standard' as const,
      overrides: {},
      settings,
    },
  };
}

describe('hordeArrivesAfterTurn', () => {
  it('counts setup turns from the turn the horde was armed', () => {
    expect(hordeArrivesAfterTurn(horde(3, 1))).toBe(3);
    expect(hordeArrivesAfterTurn(horde(3, 5))).toBe(7);
  });

  it('with no setup turns, the horde acts after the turn it was armed on', () => {
    expect(hordeArrivesAfterTurn(horde(0, 4))).toBe(4);
  });
});

describe('isHordeTurnDue', () => {
  it('is not due during the setup turns', () => {
    expect(isHordeTurnDue(horde(3, 1), 1)).toBe(false);
    expect(isHordeTurnDue(horde(3, 1), 2)).toBe(false);
  });

  it('is due from the last setup turn on', () => {
    expect(isHordeTurnDue(horde(3, 1), 3)).toBe(true);
    expect(isHordeTurnDue(horde(3, 1), 9)).toBe(true);
  });

  it('is never due while the horde is mid-turn or the game has ended', () => {
    expect(isHordeTurnDue(horde(0, 1, 'reveal'), 5)).toBe(false);
    expect(isHordeTurnDue(horde(0, 1, 'combat'), 5)).toBe(false);
    expect(isHordeTurnDue(horde(0, 1, 'ended'), 5)).toBe(false);
  });
});

describe('hordeCreatureIds', () => {
  it('returns only the creatures currently on the battlefield', () => {
    const board = createPlaytestState({
      library: [
        { id: 'zombie-1', name: 'Zombie', typeLine: 'Creature — Zombie' },
        { id: 'sword-1', name: 'Sword of Fire and Ice', typeLine: 'Artifact — Equipment' },
      ],
      openingHandSize: 0,
    });
    const withPermanents = {
      ...board,
      battlefield: [
        {
          card: board.zones.library[0],
          tapped: false,
          counters: {},
          stickers: [],
          x: 0,
          y: 0,
          faceDown: false,
        },
        {
          card: board.zones.library[1],
          tapped: false,
          counters: {},
          stickers: [],
          x: 0,
          y: 0,
          faceDown: false,
        },
      ],
    };
    expect(hordeCreatureIds(withPermanents)).toEqual(['zombie-1']);
  });

  it('is empty for a board with no creatures', () => {
    const board = createPlaytestState({ library: [], openingHandSize: 0 });
    expect(hordeCreatureIds(board)).toEqual([]);
  });
});
