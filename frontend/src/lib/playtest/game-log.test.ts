import { describe, it, expect } from 'vitest';
import {
  appendLogEntries,
  buildLogEntries,
  formatLogForClipboard,
  groupLogByTurn,
  MAX_LOG_ENTRIES,
  type GameLogEntry,
} from './game-log';
import { applyAction, createPlaytestState } from './reducer';
import type { PlaytestCard, PlaytestState } from './types';

function card(id: string, overrides: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id, name: `card-${id}`, ...overrides };
}

function deck(n: number): PlaytestCard[] {
  return Array.from({ length: n }, (_, i) => card(`c${i}`));
}

function init(libSize = 60, seed = 1, hand = 7): PlaytestState {
  return createPlaytestState({ library: deck(libSize), seed, openingHandSize: hand });
}

function entry(overrides: Partial<GameLogEntry> = {}): GameLogEntry {
  return { seq: 1, turn: 1, kind: 'draw', text: 'Drew 1 card', ...overrides };
}

describe('buildLogEntries', () => {
  it('logs a turn boundary', () => {
    const s = init(10, 1, 0);
    const next = applyAction(s, { type: 'NEXT_TURN' });
    expect(buildLogEntries(s, { type: 'NEXT_TURN' }, next)).toEqual([
      { turn: 2, kind: 'turn', text: 'Turn 2 begins' },
    ]);
  });

  it('logs a draw with the actual count', () => {
    const s = init(10, 1, 0);
    const next = applyAction(s, { type: 'DRAW', n: 3 });
    expect(buildLogEntries(s, { type: 'DRAW', n: 3 }, next)).toEqual([
      { turn: 1, kind: 'draw', text: 'Drew 3 cards' },
    ]);
  });

  it('does not log a draw that took nothing (empty library)', () => {
    const s = init(0, 1, 0);
    const next = applyAction(s, { type: 'DRAW', n: 1 });
    expect(buildLogEntries(s, { type: 'DRAW', n: 1 }, next)).toEqual([]);
  });

  it('logs a shuffle', () => {
    const s = init(5, 1, 0);
    const next = applyAction(s, { type: 'SHUFFLE_LIBRARY' });
    expect(buildLogEntries(s, { type: 'SHUFFLE_LIBRARY' }, next)).toEqual([
      { turn: 1, kind: 'shuffle', text: 'Shuffled the library' },
    ]);
  });

  it('logs a mulligan to the resulting hand size', () => {
    const s = init(10, 1, 7);
    const next = applyAction(s, { type: 'MULLIGAN', handSize: 6 });
    expect(buildLogEntries(s, { type: 'MULLIGAN', handSize: 6 }, next)).toEqual([
      { turn: 1, kind: 'mulligan', text: 'Mulliganed to 6' },
    ]);
  });

  it('logs a play from hand to the battlefield', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const next = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 0, y: 0 });
    const entries = buildLogEntries(s, { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 0, y: 0 }, next);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('play');
    expect(entries[0].text).toContain('played from hand');
    expect(entries[0].cardName).toBe(s.zones.hand[0].name);
  });

  it('logs a play from the command zone', () => {
    const cmdr = card('cmdr', { name: 'Atraxa' });
    const s = createPlaytestState({ library: deck(20), command: [cmdr], seed: 1 });
    const next = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: 'cmdr', x: 0, y: 0 });
    const entries = buildLogEntries(
      s,
      { type: 'MOVE_TO_BATTLEFIELD', cardId: 'cmdr', x: 0, y: 0 },
      next
    );
    expect(entries[0].text).toBe('Atraxa played from command zone');
  });

  it('does not log a battlefield reposition as a play', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const onBoard = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 0, y: 0 });
    // Re-dropping an already-on-battlefield card onto the battlefield is a
    // reposition (the reducer keeps it in place), not a fresh play.
    const repositioned = applyAction(onBoard, { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 9, y: 9 });
    expect(
      buildLogEntries(onBoard, { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 9, y: 9 }, repositioned)
    ).toEqual([]);
  });

  it('logs a zone move between two non-battlefield zones', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const next = applyAction(s, { type: 'MOVE_TO_ZONE', cardId, to: 'graveyard' });
    const entries = buildLogEntries(s, { type: 'MOVE_TO_ZONE', cardId, to: 'graveyard' }, next);
    expect(entries[0].text).toBe(`${s.zones.hand[0].name}: hand → graveyard`);
  });

  it('skips a no-op move to the same zone', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const next = applyAction(s, { type: 'MOVE_TO_ZONE', cardId, to: 'hand', toIndex: 0 });
    expect(
      buildLogEntries(s, { type: 'MOVE_TO_ZONE', cardId, to: 'hand', toIndex: 0 }, next)
    ).toEqual([]);
  });

  it('logs a card leaving the battlefield to a zone', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const onBoard = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 0, y: 0 });
    const next = applyAction(onBoard, { type: 'MOVE_TO_ZONE', cardId, to: 'graveyard' });
    const entries = buildLogEntries(
      onBoard,
      { type: 'MOVE_TO_ZONE', cardId, to: 'graveyard' },
      next
    );
    expect(entries[0].text).toBe(`${s.zones.hand[0].name}: battlefield → graveyard`);
  });

  it('describes a token leaving the battlefield as ceasing to exist', () => {
    const s = init(5, 1, 0);
    const withToken = applyAction(s, {
      type: 'CREATE_TOKEN',
      card: card('tok1', { name: 'Squirrel', isToken: true }),
      x: 0,
      y: 0,
    });
    const next = applyAction(withToken, { type: 'MOVE_TO_ZONE', cardId: 'tok1', to: 'graveyard' });
    const entries = buildLogEntries(
      withToken,
      { type: 'MOVE_TO_ZONE', cardId: 'tok1', to: 'graveyard' },
      next
    );
    expect(entries[0].text).toBe('Squirrel left the battlefield (ceased to exist)');
  });

  it('a token moved to the command zone is a normal zone move, not a cessation', () => {
    const s = init(5, 1, 0);
    const withToken = applyAction(s, {
      type: 'CREATE_TOKEN',
      card: card('tok1', { name: 'Squirrel', isToken: true }),
      x: 0,
      y: 0,
    });
    const next = applyAction(withToken, { type: 'MOVE_TO_ZONE', cardId: 'tok1', to: 'command' });
    const entries = buildLogEntries(
      withToken,
      { type: 'MOVE_TO_ZONE', cardId: 'tok1', to: 'command' },
      next
    );
    expect(entries[0].text).toBe('Squirrel: battlefield → command zone');
  });

  it('logs token creation', () => {
    const s = init(5, 1, 0);
    const tok = card('tok1', { name: 'Squirrel', isToken: true });
    const next = applyAction(s, { type: 'CREATE_TOKEN', card: tok, x: 0, y: 0 });
    expect(buildLogEntries(s, { type: 'CREATE_TOKEN', card: tok, x: 0, y: 0 }, next)).toEqual([
      { turn: 1, kind: 'token', text: 'Created token: Squirrel', cardName: 'Squirrel' },
    ]);
  });

  it('logs untap all', () => {
    const s = init(5, 1, 0);
    const next = applyAction(s, { type: 'UNTAP_ALL' });
    expect(buildLogEntries(s, { type: 'UNTAP_ALL' }, next)).toEqual([
      { turn: 1, kind: 'tap-all', text: 'Untapped all permanents' },
    ]);
  });

  it('does not log per-card taps, stickers, counters, or repositions', () => {
    const s = init(5, 1, 0);
    const withToken = applyAction(s, {
      type: 'CREATE_TOKEN',
      card: card('tok1', { name: 'Squirrel', isToken: true }),
      x: 0,
      y: 0,
    });
    const cardId = 'tok1';
    for (const action of [
      { type: 'TAP', cardId } as const,
      { type: 'SET_COUNTER', cardId, counter: '+1/+1', delta: 1 } as const,
      { type: 'ADD_STICKER', cardId, text: 'flying' } as const,
      { type: 'MOVE_BF_POSITION', cardId, x: 1, y: 1 } as const,
      { type: 'FLIP_FACE', cardId } as const,
    ]) {
      const next = applyAction(withToken, action);
      expect(buildLogEntries(withToken, action, next)).toEqual([]);
    }
  });

  describe('life (E138)', () => {
    it('logs your own life change', () => {
      const s = init(5, 1, 0);
      const action = { type: 'ADJUST_LIFE', player: 'self', delta: -5 } as const;
      const next = applyAction(s, action);
      expect(buildLogEntries(s, action, next)).toEqual([
        { turn: 1, kind: 'life', text: 'Your life: 20 → 15' },
      ]);
    });

    it('logs an opponent life change, labeled by index when there are several', () => {
      const s = createPlaytestState({
        library: deck(5),
        seed: 1,
        openingHandSize: 0,
        opponentCount: 2,
        opponentLife: 40,
      });
      const action = { type: 'ADJUST_LIFE', player: 1, delta: -10 } as const;
      const next = applyAction(s, action);
      expect(buildLogEntries(s, action, next)).toEqual([
        { turn: 1, kind: 'life', text: 'Opponent 2 life: 40 → 30' },
      ]);
    });

    it('does not log a no-op life adjustment (out-of-range index)', () => {
      const s = init(5, 1, 0);
      const action = { type: 'ADJUST_LIFE', player: 5, delta: -1 } as const;
      const next = applyAction(s, action);
      expect(buildLogEntries(s, action, next)).toEqual([]);
    });

    it('logs commander damage, singular "Opponent" label with only one', () => {
      const s = init(5, 1, 0);
      const action = { type: 'ADJUST_COMMANDER_DAMAGE', opponent: 0, delta: 6 } as const;
      const next = applyAction(s, action);
      expect(buildLogEntries(s, action, next)).toEqual([
        { turn: 1, kind: 'life', text: 'Opponent commander damage: 0 → 6' },
      ]);
    });

    it('does not log a no-op commander damage adjustment (out-of-range index)', () => {
      const s = init(5, 1, 0);
      const action = { type: 'ADJUST_COMMANDER_DAMAGE', opponent: 5, delta: 1 } as const;
      const next = applyAction(s, action);
      expect(buildLogEntries(s, action, next)).toEqual([]);
    });
  });
});

describe('appendLogEntries', () => {
  it('is a no-op when there is nothing to add', () => {
    const log = [entry({ seq: 1 })];
    expect(appendLogEntries(log, [])).toBe(log);
  });

  it('stamps ascending seq continuing from the log tail', () => {
    const log = [entry({ seq: 5 })];
    const result = appendLogEntries(log, [
      { turn: 1, kind: 'draw', text: 'a' },
      { turn: 1, kind: 'draw', text: 'b' },
    ]);
    expect(result.map((e) => e.seq)).toEqual([5, 6, 7]);
  });

  it('starts seq at 1 for an empty log', () => {
    const result = appendLogEntries([], [{ turn: 1, kind: 'draw', text: 'a' }]);
    expect(result[0].seq).toBe(1);
  });

  it('caps at MAX_LOG_ENTRIES, dropping the oldest', () => {
    const log = Array.from({ length: MAX_LOG_ENTRIES }, (_, i) => entry({ seq: i + 1 }));
    const result = appendLogEntries(log, [{ turn: 1, kind: 'draw', text: 'new' }]);
    expect(result).toHaveLength(MAX_LOG_ENTRIES);
    expect(result[0].seq).toBe(2);
    expect(result.at(-1)?.text).toBe('new');
  });
});

describe('groupLogByTurn', () => {
  it('groups contiguous entries by turn, preserving chronological order', () => {
    const log: GameLogEntry[] = [
      entry({ seq: 1, turn: 1, text: 'a' }),
      entry({ seq: 2, turn: 1, text: 'b' }),
      entry({ seq: 3, turn: 2, kind: 'turn', text: 'Turn 2 begins' }),
      entry({ seq: 4, turn: 2, text: 'c' }),
    ];
    const groups = groupLogByTurn(log);
    expect(groups).toEqual([
      { turn: 1, entries: [log[0], log[1]] },
      { turn: 2, entries: [log[2], log[3]] },
    ]);
  });

  it('starts a fresh group at a reset even if the turn number repeats', () => {
    const log: GameLogEntry[] = [
      entry({ seq: 1, turn: 1, text: 'a' }),
      entry({ seq: 2, turn: 1, kind: 'reset', text: 'Game reset' }),
      entry({ seq: 3, turn: 1, text: 'b (fresh game)' }),
    ];
    const groups = groupLogByTurn(log);
    expect(groups).toHaveLength(2);
    expect(groups[0].entries).toEqual([log[0]]);
    expect(groups[1].entries).toEqual([log[1], log[2]]);
  });
});

describe('formatLogForClipboard', () => {
  it('returns a placeholder for an empty log', () => {
    expect(formatLogForClipboard([])).toBe('No game events yet.');
  });

  it('renders turn headers oldest-first with bulleted entries', () => {
    const log: GameLogEntry[] = [
      entry({ seq: 1, turn: 1, text: 'Drew 1 card' }),
      entry({ seq: 2, turn: 2, kind: 'turn', text: 'Turn 2 begins' }),
      entry({ seq: 3, turn: 2, text: 'Drew 1 card' }),
    ];
    expect(formatLogForClipboard(log)).toBe(
      'Turn 1\n- Drew 1 card\n\nTurn 2\n- Turn 2 begins\n- Drew 1 card'
    );
  });
});
