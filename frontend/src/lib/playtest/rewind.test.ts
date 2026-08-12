import { describe, expect, it } from 'vitest';
import { classifyAction, walkRewindable, type RewindLogEntry, type RewindVerdict } from './rewind';
import { applyAction, createPlaytestState } from './reducer';
import type { PlaytestAction, PlaytestCard, PlaytestState } from './types';

function card(id: string, overrides: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id, name: `card-${id}`, ...overrides };
}

function deck(n: number): PlaytestCard[] {
  return Array.from({ length: n }, (_, i) => card(`c${i}`));
}

function init(libSize = 10, seed = 1, hand = 1): PlaytestState {
  return createPlaytestState({ library: deck(libSize), seed, openingHandSize: hand });
}

/**
 * One sample action per member of the `PlaytestAction` discriminated union,
 * keyed by its `type`. `Record<PlaytestAction['type'], PlaytestAction>` means
 * this object literal is missing a key — a compile error — the moment a new
 * action type is added to `PlaytestAction` and not given a sample here. That
 * failure (surfacing as a typecheck break, not a runtime assertion) is the
 * "table-driven test that fails when a new action type is left unclassified"
 * the classifier needs: it's impossible to add a case to `PlaytestAction`
 * without this file, and `classifyAction`'s own default-less switch, both
 * refusing to compile until it's classified.
 */
const SAMPLE_ACTIONS: Record<PlaytestAction['type'], PlaytestAction> = {
  DRAW: { type: 'DRAW' },
  SHUFFLE_LIBRARY: { type: 'SHUFFLE_LIBRARY' },
  MULLIGAN: { type: 'MULLIGAN' },
  MOVE_TO_ZONE: { type: 'MOVE_TO_ZONE', cardId: 'x', to: 'graveyard' },
  RESOLVE_TOP: { type: 'RESOLVE_TOP', mode: 'scry', top: [] },
  MOVE_TO_BATTLEFIELD: { type: 'MOVE_TO_BATTLEFIELD', cardId: 'x', x: 0, y: 0 },
  MOVE_BF_POSITION: { type: 'MOVE_BF_POSITION', cardId: 'x', x: 0, y: 0 },
  TAP: { type: 'TAP', cardId: 'x' },
  UNTAP_ALL: { type: 'UNTAP_ALL' },
  SET_COUNTER: { type: 'SET_COUNTER', cardId: 'x', counter: '+1/+1', delta: 1 },
  ADD_STICKER: { type: 'ADD_STICKER', cardId: 'x', text: 'flying' },
  REMOVE_STICKER: { type: 'REMOVE_STICKER', cardId: 'x', index: 0 },
  CREATE_TOKEN: { type: 'CREATE_TOKEN', card: card('t', { isToken: true }), x: 0, y: 0 },
  CLONE_BF_CARDS: { type: 'CLONE_BF_CARDS', clones: [] },
  ATTACH: { type: 'ATTACH', cardId: 'x', targetId: null },
  FLIP_FACE: { type: 'FLIP_FACE', cardId: 'x' },
  TRANSFORM: { type: 'TRANSFORM', cardId: 'x' },
  TOGGLE_PHASED: { type: 'TOGGLE_PHASED', cardId: 'x' },
  ADJUST_MANA: { type: 'ADJUST_MANA', color: 'W', delta: 1 },
  EMPTY_MANA_POOL: { type: 'EMPTY_MANA_POOL' },
  SET_CARD_IMAGE: { type: 'SET_CARD_IMAGE', cardId: 'x', imageUrl: 'https://example.com/a.png' },
  NEXT_TURN: { type: 'NEXT_TURN' },
  RESET: { type: 'RESET' },
  UNDO: { type: 'UNDO' },
  ADJUST_LIFE: { type: 'ADJUST_LIFE', player: 'self', delta: -1 },
  ADJUST_COMMANDER_DAMAGE: { type: 'ADJUST_COMMANDER_DAMAGE', opponent: 0, delta: 1 },
  SET_PLAYER_COUNTER: { type: 'SET_PLAYER_COUNTER', player: 'self', counter: 'poison', delta: 1 },
  SET_DESIGNATION: { type: 'SET_DESIGNATION', designation: 'monarch', held: true },
};

const VERDICTS: readonly RewindVerdict[] = ['locked', 'consent', 'free'];

describe('classifyAction — every action type', () => {
  const state = init(5, 1, 1);

  it.each(Object.entries(SAMPLE_ACTIONS))(
    'classifies %s with a verdict and a reason',
    (_type, action) => {
      const result = classifyAction(state, action);
      expect(VERDICTS).toContain(result.verdict);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  );

  // The bucketing the PR promises: hidden-information actions are locked,
  // no exceptions, regardless of which state they're evaluated against.
  it.each(['DRAW', 'MULLIGAN', 'SHUFFLE_LIBRARY', 'RESOLVE_TOP'] as const)(
    '%s is always locked',
    (type) => {
      expect(classifyAction(state, SAMPLE_ACTIONS[type]).verdict).toBe('locked');
    }
  );
});

describe('classifyAction — MOVE_TO_ZONE source-zone sensitivity', () => {
  it('library -> hand (a tutor) is locked', () => {
    const s = init(10, 1, 0);
    const cardId = s.zones.library[0].id;
    const action: PlaytestAction = { type: 'MOVE_TO_ZONE', cardId, to: 'hand' };
    expect(classifyAction(s, action).verdict).toBe('locked');
  });

  it('hand -> graveyard (a discard) is consent', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const action: PlaytestAction = { type: 'MOVE_TO_ZONE', cardId, to: 'graveyard' };
    expect(classifyAction(s, action).verdict).toBe('consent');
  });

  it('battlefield -> graveyard is consent, not locked', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const onBoard = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 0, y: 0 });
    const action: PlaytestAction = { type: 'MOVE_TO_ZONE', cardId, to: 'graveyard' };
    expect(classifyAction(onBoard, action).verdict).toBe('consent');
  });

  it('the same cardId classifies differently depending on which zone it started in', () => {
    // Same action shape (cardId + destination), two different "before" states
    // — proves the verdict is read off `current`, not off the action alone.
    const s = init(10, 1, 1);
    const handCardId = s.zones.hand[0].id;
    const libraryCardId = s.zones.library[0].id;
    const toGraveyard = (cardId: string): PlaytestAction => ({
      type: 'MOVE_TO_ZONE',
      cardId,
      to: 'graveyard',
    });
    expect(classifyAction(s, toGraveyard(handCardId)).verdict).toBe('consent');
    expect(classifyAction(s, toGraveyard(libraryCardId)).verdict).toBe('locked');
  });
});

describe('classifyAction — MOVE_TO_BATTLEFIELD source-zone sensitivity', () => {
  it('library -> battlefield is locked', () => {
    const s = init(10, 1, 0);
    const cardId = s.zones.library[0].id;
    const action: PlaytestAction = { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 0, y: 0 };
    expect(classifyAction(s, action).verdict).toBe('locked');
  });

  it('hand -> battlefield (a normal play) is consent', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const action: PlaytestAction = { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 0, y: 0 };
    expect(classifyAction(s, action).verdict).toBe('consent');
  });

  it('battlefield -> battlefield (a reposition) is free', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const onBoard = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 0, y: 0 });
    const action: PlaytestAction = { type: 'MOVE_TO_BATTLEFIELD', cardId, x: 0.5, y: 0.5 };
    expect(classifyAction(onBoard, action).verdict).toBe('free');
  });
});

describe('classifyAction — purity', () => {
  it('the same state and action always classify the same way', () => {
    const s = init(10, 1, 1);
    const cardId = s.zones.hand[0].id;
    const action: PlaytestAction = { type: 'MOVE_TO_ZONE', cardId, to: 'graveyard' };
    const first = classifyAction(s, action);
    const second = classifyAction(s, action);
    expect(first).toEqual(second);
  });
});

function entry(id: string, verdict?: RewindVerdict): RewindLogEntry & { id: string } {
  return { id, verdict };
}

describe('walkRewindable', () => {
  it('stops at a locked entry and reports it as the hard-wall boundary', () => {
    // Oldest-first, matching game-log.ts's append order.
    const log = [entry('draw', 'locked'), entry('play', 'consent'), entry('tap', 'free')];
    const walk = walkRewindable(log);
    expect(walk.stepsAvailable).toBe(2);
    expect(walk.boundary).toBe(log[0]);
  });

  it('reports the first (nearest-to-now) consent entry within the rewindable window', () => {
    const log = [entry('life', 'consent'), entry('tap', 'free'), entry('untap', 'free')];
    const walk = walkRewindable(log);
    expect(walk.stepsAvailable).toBe(3);
    expect(walk.boundary).toBeNull();
    expect(walk.firstConsentEntry).toBe(log[0]);
    expect(walk.firstConsentIndex).toBe(2);
  });

  it('is fully rewindable, with no boundary, when nothing is locked', () => {
    const log = [entry('a', 'free'), entry('b', 'consent'), entry('c', 'free')];
    const walk = walkRewindable(log);
    expect(walk.stepsAvailable).toBe(3);
    expect(walk.boundary).toBeNull();
  });

  it('reports zero steps when the most recent entry is itself locked', () => {
    const log = [entry('play', 'consent'), entry('draw', 'locked')];
    const walk = walkRewindable(log);
    expect(walk.stepsAvailable).toBe(0);
    expect(walk.boundary).toBe(log[1]);
  });

  it('treats an entry with no verdict (a pre-feature persisted log) as a conservative locked wall', () => {
    const log = [entry('legacy'), entry('tap', 'free')];
    const walk = walkRewindable(log);
    expect(walk.stepsAvailable).toBe(1);
    expect(walk.boundary).toBe(log[0]);
  });

  it('returns zero steps and no boundary for an empty log', () => {
    const walk = walkRewindable([]);
    expect(walk.stepsAvailable).toBe(0);
    expect(walk.boundary).toBeNull();
    expect(walk.firstConsentIndex).toBeNull();
  });

  it('is pure: the same log always walks to the same result, and is never mutated', () => {
    const log = [entry('a', 'consent'), entry('b', 'locked'), entry('c', 'free')];
    const snapshot = log.map((e) => ({ ...e }));
    const first = walkRewindable(log);
    const second = walkRewindable(log);
    expect(first).toEqual(second);
    expect(log).toEqual(snapshot);
  });
});
