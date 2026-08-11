import { describe, it, expect } from 'vitest';
import { createPlaytestState } from './reducer';
import { toPublicBoard, toProjectedCard } from './projection';
import type { PlaytestCard, PlaytestState } from './types';

function card(id: string, overrides: Partial<PlaytestCard> = {}): PlaytestCard {
  return {
    id,
    name: `card-${id}`,
    oracleId: `oracle-${id}`,
    scryfallId: `scry-${id}`,
    imageUrl: `https://img.example/${id}.png`,
    backImageUrl: `https://img.example/${id}-back.png`,
    manaValue: 3,
    typeLine: 'Creature — Bear',
    ...overrides,
  };
}

function deck(n: number): PlaytestCard[] {
  return Array.from({ length: n }, (_, i) => card(`lib${i}`));
}

function baseState(overrides: Partial<PlaytestState> = {}): PlaytestState {
  const s = createPlaytestState({ library: deck(10), seed: 1, openingHandSize: 3 });
  return { ...s, ...overrides };
}

describe('toPublicBoard', () => {
  it('never leaks hand or library contents', () => {
    const s = baseState({
      zones: {
        library: [card('secretlib', { name: 'Secret Library Card' })],
        hand: [card('secrethand', { name: 'Secret Hand Card' })],
        graveyard: [],
        exile: [],
        command: [],
      },
    });
    const board = toPublicBoard(s, 0);
    const serialized = JSON.stringify(board);
    expect(serialized).not.toContain('Secret Library Card');
    expect(serialized).not.toContain('Secret Hand Card');
    expect(serialized).not.toContain('secretlib');
    expect(serialized).not.toContain('secrethand');
  });

  it('reports hand/library as counts only', () => {
    const s = baseState({
      zones: {
        library: deck(5),
        hand: [card('h0'), card('h1')],
        graveyard: [],
        exile: [],
        command: [],
      },
    });
    const board = toPublicBoard(s, 0);
    expect(board.handCount).toBe(2);
    expect(board.libraryCount).toBe(5);
  });

  it('redacts a face-down battlefield card to position/tapped/counters, not identity', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('morph1', { name: 'Willbender' }),
          tapped: true,
          counters: { '+1/+1': 2 },
          stickers: ['flying'],
          x: 0.25,
          y: 0.5,
          faceDown: true,
        },
      ],
    });
    const board = toPublicBoard(s, 0);
    const bf = board.battlefield[0];
    expect(bf.faceDown).toBe(true);
    expect(bf.tapped).toBe(true);
    expect(bf.x).toBe(0.25);
    expect(bf.y).toBe(0.5);
    expect(bf.counters).toEqual({ '+1/+1': 2 });
    expect(bf.stickers).toEqual(['flying']);
    expect(bf.card.id).toBe('morph1');

    const serialized = JSON.stringify(board);
    expect(serialized).not.toContain('Willbender');
    expect(serialized).not.toContain('scry-morph1');
    expect(serialized).not.toContain('oracle-morph1');
  });

  it('projects a face-up card identity normally', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('bear1', { name: 'Grizzly Bears' }),
          tapped: false,
          counters: {},
          stickers: [],
          x: 0.1,
          y: 0.1,
          faceDown: false,
        },
      ],
    });
    const board = toPublicBoard(s, 0);
    expect(board.battlefield[0].card.name).toBe('Grizzly Bears');
    expect(board.battlefield[0].card.scryfallId).toBe('scry-bear1');
  });

  it('projects a face-up transformed DFC identity normally (showBackFace is public)', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('dfc1', { name: 'Delver of Secrets' }),
          tapped: false,
          counters: {},
          stickers: [],
          x: 0.1,
          y: 0.1,
          faceDown: false,
          showBackFace: true,
        },
      ],
    });
    const board = toPublicBoard(s, 0);
    const bf = board.battlefield[0];
    expect(bf.showBackFace).toBe(true);
    expect(bf.card.name).toBe('Delver of Secrets');
    expect(bf.card.scryfallId).toBe('scry-dfc1');
  });

  it('strips image URLs from every projected card', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('imgbf'),
          tapped: false,
          counters: {},
          stickers: [],
          x: 0,
          y: 0,
          faceDown: false,
        },
      ],
      zones: {
        library: [],
        hand: [],
        graveyard: [card('imggy')],
        exile: [card('imgex')],
        command: [card('imgcmd')],
      },
    });
    const board = toPublicBoard(s, 0);
    const serialized = JSON.stringify(board);
    expect(serialized).not.toContain('img.example');
    expect(serialized).not.toContain('imageUrl');
    expect(serialized).not.toContain('backImageUrl');
  });

  it('omits solo-only virtual-opponent bookkeeping and the undo stack', () => {
    const s = baseState({
      opponents: [{ life: 40, commanderDamage: 21, counters: { poison: 3 } }],
      tableDefeatedTurn: 5,
      startingOpponentLife: 40,
      past: [
        {
          ...baseState(),
          zones: { library: [], hand: [], graveyard: [], exile: [], command: [] },
        },
      ],
    });
    const board = toPublicBoard(s, 0);
    const serialized = JSON.stringify(board);
    expect(serialized).not.toContain('opponents');
    expect(serialized).not.toContain('tableDefeatedTurn');
    expect(serialized).not.toContain('startingOpponentLife');
    expect(serialized).not.toContain('"past"');
    expect(board).not.toHaveProperty('opponents');
    expect(board).not.toHaveProperty('tableDefeatedTurn');
    expect(board).not.toHaveProperty('startingOpponentLife');
    expect(board).not.toHaveProperty('past');
  });

  it('carries public per-player fields and the seat index', () => {
    const s = baseState({
      turn: 4,
      life: 33,
      playerCounters: { energy: 2 },
      manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commanderTax: { cmdr1: 2 },
      monarch: true,
      initiative: false,
      citysBlessing: true,
    });
    const board = toPublicBoard(s, 2);
    expect(board.seat).toBe(2);
    expect(board.turn).toBe(4);
    expect(board.life).toBe(33);
    expect(board.playerCounters).toEqual({ energy: 2 });
    expect(board.manaPool).toEqual({ W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(board.commanderTax).toEqual({ cmdr1: 2 });
    expect(board.monarch).toBe(true);
    expect(board.citysBlessing).toBe(true);
  });

  it('is pure: repeated calls on the same input deep-equal', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('pure1'),
          tapped: false,
          counters: { charge: 1 },
          stickers: ['big'],
          x: 0.3,
          y: 0.4,
          faceDown: true,
        },
      ],
    });
    const a = toPublicBoard(s, 1);
    const b = toPublicBoard(s, 1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('toProjectedCard', () => {
  it('drops image fields but keeps other printed metadata', () => {
    const projected = toProjectedCard(card('c1'));
    expect(projected).toEqual({
      id: 'c1',
      name: 'card-c1',
      oracleId: 'oracle-c1',
      scryfallId: 'scry-c1',
      manaValue: 3,
      typeLine: 'Creature — Bear',
      isToken: undefined,
    });
    expect(projected).not.toHaveProperty('imageUrl');
    expect(projected).not.toHaveProperty('backImageUrl');
  });
});
