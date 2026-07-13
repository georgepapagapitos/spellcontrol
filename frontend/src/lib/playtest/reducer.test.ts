import { describe, it, expect } from 'vitest';
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

function allCardIds(s: PlaytestState): string[] {
  return [
    ...s.zones.library.map((c) => c.id),
    ...s.zones.hand.map((c) => c.id),
    ...s.zones.graveyard.map((c) => c.id),
    ...s.zones.exile.map((c) => c.id),
    ...s.zones.command.map((c) => c.id),
    ...s.battlefield.map((b) => b.card.id),
  ].sort();
}

describe('createPlaytestState', () => {
  it('deals an opening hand of 7 by default', () => {
    const s = init();
    expect(s.zones.hand).toHaveLength(7);
    expect(s.zones.library).toHaveLength(53);
    expect(s.turn).toBe(1);
    expect(s.past).toEqual([]);
  });

  it('is deterministic for a given seed', () => {
    const a = init(40, 99);
    const b = init(40, 99);
    expect(a.zones.hand.map((c) => c.id)).toEqual(b.zones.hand.map((c) => c.id));
    expect(a.zones.library.map((c) => c.id)).toEqual(b.zones.library.map((c) => c.id));
  });

  it('respects custom opening hand size and clamps to library size', () => {
    const s = createPlaytestState({ library: deck(3), seed: 1, openingHandSize: 10 });
    expect(s.zones.hand).toHaveLength(3);
    expect(s.zones.library).toHaveLength(0);
  });

  it('places command-zone cards separately from the library', () => {
    const cmdr = card('cmdr', { name: 'Atraxa' });
    const s = createPlaytestState({ library: deck(99), command: [cmdr], seed: 1 });
    expect(s.zones.command).toEqual([cmdr]);
    expect(s.zones.library.find((c) => c.id === 'cmdr')).toBeUndefined();
  });
});

describe('DRAW', () => {
  it('moves the top N cards from library to hand', () => {
    const s = init(10, 1, 0);
    const top = s.zones.library.slice(0, 3).map((c) => c.id);
    const next = applyAction(s, { type: 'DRAW', n: 3 });
    expect(next.zones.hand.map((c) => c.id)).toEqual(top);
    expect(next.zones.library).toHaveLength(7);
  });

  it('defaults to 1 card', () => {
    const s = init(10, 1, 0);
    const next = applyAction(s, { type: 'DRAW' });
    expect(next.zones.hand).toHaveLength(1);
  });

  it('is a no-op when library is empty', () => {
    const s = createPlaytestState({ library: deck(2), seed: 1, openingHandSize: 2 });
    const next = applyAction(s, { type: 'DRAW', n: 1 });
    expect(next).toBe(s);
  });

  it('clamps to library size', () => {
    const s = init(2, 1, 0);
    const next = applyAction(s, { type: 'DRAW', n: 10 });
    expect(next.zones.hand).toHaveLength(2);
    expect(next.zones.library).toHaveLength(0);
  });
});

describe('SHUFFLE_LIBRARY', () => {
  it('preserves the set of library cards', () => {
    const s = init(20, 1);
    const before = s.zones.library.map((c) => c.id).sort();
    const next = applyAction(s, { type: 'SHUFFLE_LIBRARY' });
    expect(next.zones.library.map((c) => c.id).sort()).toEqual(before);
  });

  it('advances the RNG seed', () => {
    const s = init(20, 1);
    const next = applyAction(s, { type: 'SHUFFLE_LIBRARY' });
    expect(next.rngSeed).not.toBe(s.rngSeed);
  });
});

describe('MULLIGAN', () => {
  it('reshuffles hand back into library and redraws', () => {
    const s = init(20, 1);
    const ids = allCardIds(s);
    const next = applyAction(s, { type: 'MULLIGAN' });
    expect(allCardIds(next)).toEqual(ids);
    expect(next.zones.hand).toHaveLength(7);
  });

  it('respects custom hand size (London mulligan)', () => {
    const s = init(20, 1);
    const next = applyAction(s, { type: 'MULLIGAN', handSize: 6 });
    expect(next.zones.hand).toHaveLength(6);
  });
});

describe('MOVE_TO_ZONE', () => {
  it('moves a card from hand to graveyard', () => {
    const s = init(10, 1, 3);
    const target = s.zones.hand[1].id;
    const next = applyAction(s, { type: 'MOVE_TO_ZONE', cardId: target, to: 'graveyard' });
    expect(next.zones.hand.find((c) => c.id === target)).toBeUndefined();
    expect(next.zones.graveyard.map((c) => c.id)).toContain(target);
  });

  it('inserts at the given index', () => {
    let s = init(10, 1, 3);
    const a = s.zones.hand[0].id;
    const b = s.zones.hand[1].id;
    s = applyAction(s, { type: 'MOVE_TO_ZONE', cardId: a, to: 'exile' });
    s = applyAction(s, { type: 'MOVE_TO_ZONE', cardId: b, to: 'exile', toIndex: 0 });
    expect(s.zones.exile.map((c) => c.id)).toEqual([b, a]);
  });

  it('returns state unchanged when card id is unknown', () => {
    const s = init(10, 1, 3);
    const next = applyAction(s, { type: 'MOVE_TO_ZONE', cardId: 'nope', to: 'graveyard' });
    expect(next).toBe(s);
  });

  it('removes tokens that leave the battlefield (except to command zone)', () => {
    let s = init(10, 1, 0);
    const token: PlaytestCard = { id: 'tok1', name: 'Goblin', isToken: true };
    s = applyAction(s, { type: 'CREATE_TOKEN', card: token, x: 0, y: 0 });
    s = applyAction(s, { type: 'MOVE_TO_ZONE', cardId: 'tok1', to: 'graveyard' });
    expect(s.battlefield).toHaveLength(0);
    expect(s.zones.graveyard).toHaveLength(0);
  });
});

describe('MOVE_TO_BATTLEFIELD', () => {
  it('moves a card from hand onto the battlefield with position', () => {
    const s = init(10, 1, 3);
    const target = s.zones.hand[0].id;
    const next = applyAction(s, {
      type: 'MOVE_TO_BATTLEFIELD',
      cardId: target,
      x: 100,
      y: 200,
    });
    expect(next.zones.hand.find((c) => c.id === target)).toBeUndefined();
    const bf = next.battlefield.find((b) => b.card.id === target);
    expect(bf).toBeDefined();
    expect(bf?.x).toBe(100);
    expect(bf?.y).toBe(200);
    expect(bf?.tapped).toBe(false);
    expect(bf?.counters).toEqual({});
  });

  it('can enter tapped', () => {
    const s = init(10, 1, 3);
    const target = s.zones.hand[0].id;
    const next = applyAction(s, {
      type: 'MOVE_TO_BATTLEFIELD',
      cardId: target,
      x: 0,
      y: 0,
      tapped: true,
    });
    expect(next.battlefield[0].tapped).toBe(true);
  });

  it('preserves counters when called on a card already on the battlefield', () => {
    let s = init(10, 1, 3);
    const target = s.zones.hand[0].id;
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: target, x: 0, y: 0 });
    s = applyAction(s, { type: 'SET_COUNTER', cardId: target, counter: '+1/+1', delta: 2 });
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: target, x: 50, y: 50 });
    const bf = s.battlefield.find((b) => b.card.id === target);
    expect(bf?.counters).toEqual({ '+1/+1': 2 });
    expect(bf?.x).toBe(50);
  });
});

describe('MOVE_BF_POSITION / TAP / UNTAP_ALL / FLIP_FACE', () => {
  function withCardOnBattlefield() {
    let s = init(10, 1, 3);
    const id = s.zones.hand[0].id;
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: id, x: 0, y: 0 });
    return { s, id };
  }

  it('repositions on the battlefield', () => {
    const { s, id } = withCardOnBattlefield();
    const next = applyAction(s, { type: 'MOVE_BF_POSITION', cardId: id, x: 300, y: 400 });
    const bf = next.battlefield.find((b) => b.card.id === id);
    expect(bf?.x).toBe(300);
    expect(bf?.y).toBe(400);
  });

  it('brings the dragged card to the end of the array (front of the stack)', () => {
    let s = init(10, 1, 4);
    const [a, b, c] = s.zones.hand.map((card) => card.id);
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: a, x: 0, y: 0 });
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: b, x: 10, y: 10 });
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: c, x: 20, y: 20 });
    expect(s.battlefield.map((bf) => bf.card.id)).toEqual([a, b, c]);

    // Dragging the bottom-most card (a) should move it to the end.
    const next = applyAction(s, { type: 'MOVE_BF_POSITION', cardId: a, x: 5, y: 5 });
    expect(next.battlefield.map((bf) => bf.card.id)).toEqual([b, c, a]);
    expect(next.battlefield.find((bf) => bf.card.id === a)).toMatchObject({ x: 5, y: 5 });
  });

  it('does not reorder the battlefield on TAP', () => {
    let s = init(10, 1, 3);
    const [a, b] = s.zones.hand.map((card) => card.id);
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: a, x: 0, y: 0 });
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: b, x: 10, y: 10 });
    const next = applyAction(s, { type: 'TAP', cardId: a });
    expect(next.battlefield.map((bf) => bf.card.id)).toEqual([a, b]);
  });

  it('undo restores the pre-drag battlefield order', () => {
    let s = init(10, 1, 3);
    const [a, b] = s.zones.hand.map((card) => card.id);
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: a, x: 0, y: 0 });
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: b, x: 10, y: 10 });
    const dragged = applyAction(s, { type: 'MOVE_BF_POSITION', cardId: a, x: 5, y: 5 });
    expect(dragged.battlefield.map((bf) => bf.card.id)).toEqual([b, a]);
    const undone = applyAction(dragged, { type: 'UNDO' });
    expect(undone.battlefield.map((bf) => bf.card.id)).toEqual([a, b]);
  });

  it('toggles tapped when no explicit value is given', () => {
    const base = withCardOnBattlefield();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'TAP', cardId: id });
    expect(s.battlefield[0].tapped).toBe(true);
    s = applyAction(s, { type: 'TAP', cardId: id });
    expect(s.battlefield[0].tapped).toBe(false);
  });

  it('sets tapped explicitly when value provided', () => {
    const { s, id } = withCardOnBattlefield();
    const next = applyAction(s, { type: 'TAP', cardId: id, tapped: true });
    expect(next.battlefield[0].tapped).toBe(true);
  });

  it('UNTAP_ALL only untaps battlefield cards (not other zones)', () => {
    const base = withCardOnBattlefield();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'TAP', cardId: id, tapped: true });
    s = applyAction(s, { type: 'UNTAP_ALL' });
    expect(s.battlefield[0].tapped).toBe(false);
  });

  it('UNTAP_ALL is a no-op when nothing is tapped', () => {
    const { s } = withCardOnBattlefield();
    const next = applyAction(s, { type: 'UNTAP_ALL' });
    expect(next).toBe(s);
  });

  it('flips face state', () => {
    const { s, id } = withCardOnBattlefield();
    const next = applyAction(s, { type: 'FLIP_FACE', cardId: id });
    expect(next.battlefield[0].faceDown).toBe(true);
    expect(applyAction(next, { type: 'FLIP_FACE', cardId: id }).battlefield[0].faceDown).toBe(
      false
    );
  });
});

describe('SET_COUNTER', () => {
  function withCard() {
    let s = init(10, 1, 3);
    const id = s.zones.hand[0].id;
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: id, x: 0, y: 0 });
    return { s, id };
  }

  it('adds counters with positive delta', () => {
    const base = withCard();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'SET_COUNTER', cardId: id, counter: '+1/+1', delta: 3 });
    expect(s.battlefield[0].counters['+1/+1']).toBe(3);
  });

  it('removes the counter entry when count reaches zero', () => {
    const base = withCard();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'SET_COUNTER', cardId: id, counter: 'loyalty', delta: 3 });
    s = applyAction(s, { type: 'SET_COUNTER', cardId: id, counter: 'loyalty', delta: -3 });
    expect(s.battlefield[0].counters.loyalty).toBeUndefined();
    expect(Object.keys(s.battlefield[0].counters)).toHaveLength(0);
  });

  it('supports multiple counter kinds on the same card', () => {
    const base = withCard();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'SET_COUNTER', cardId: id, counter: '+1/+1', delta: 2 });
    s = applyAction(s, { type: 'SET_COUNTER', cardId: id, counter: 'charge', delta: 1 });
    expect(s.battlefield[0].counters).toEqual({ '+1/+1': 2, charge: 1 });
  });
});

describe('ADD_STICKER / REMOVE_STICKER', () => {
  function withCard() {
    let s = init(10, 1, 3);
    const id = s.zones.hand[0].id;
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: id, x: 0, y: 0 });
    return { s, id };
  }

  it('initializes battlefield entries and tokens with no stickers', () => {
    const { s } = withCard();
    expect(s.battlefield[0].stickers).toEqual([]);
    const withToken = applyAction(s, {
      type: 'CREATE_TOKEN',
      card: { id: 'tok', name: 'Treasure' },
      x: 0,
      y: 0,
    });
    expect(withToken.battlefield[1].stickers).toEqual([]);
  });

  it('adds a sticker', () => {
    const base = withCard();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: 'flying' });
    s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: '6/6' });
    expect(s.battlefield[0].stickers).toEqual(['flying', '6/6']);
  });

  it('trims sticker text and ignores empty/whitespace-only input', () => {
    const base = withCard();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: '  flying  ' });
    expect(s.battlefield[0].stickers).toEqual(['flying']);
    const next = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: '   ' });
    expect(next).toBe(s);
  });

  it('caps sticker text at 30 characters', () => {
    const base = withCard();
    const { id } = base;
    const long = 'x'.repeat(50);
    const s = applyAction(base.s, { type: 'ADD_STICKER', cardId: id, text: long });
    expect(s.battlefield[0].stickers[0]).toBe('x'.repeat(30));
  });

  it('ignores stickers beyond the 8-per-card cap', () => {
    const base = withCard();
    const { id } = base;
    let s = base.s;
    for (let i = 0; i < 10; i++) {
      s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: `s${i}` });
    }
    expect(s.battlefield[0].stickers).toHaveLength(8);
    expect(s.battlefield[0].stickers[7]).toBe('s7');
  });

  it('removes a sticker by index', () => {
    const base = withCard();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: 'a' });
    s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: 'b' });
    s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: 'c' });
    s = applyAction(s, { type: 'REMOVE_STICKER', cardId: id, index: 1 });
    expect(s.battlefield[0].stickers).toEqual(['a', 'c']);
  });

  it('is a no-op for unknown cards or out-of-range indexes', () => {
    const base = withCard();
    const { s, id } = base;
    expect(applyAction(s, { type: 'ADD_STICKER', cardId: 'nope', text: 'x' })).toBe(s);
    expect(applyAction(s, { type: 'REMOVE_STICKER', cardId: 'nope', index: 0 })).toBe(s);
    expect(applyAction(s, { type: 'REMOVE_STICKER', cardId: id, index: 0 })).toBe(s);
    const one = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: 'x' });
    expect(applyAction(one, { type: 'REMOVE_STICKER', cardId: id, index: 1 })).toBe(one);
    expect(applyAction(one, { type: 'REMOVE_STICKER', cardId: id, index: -1 })).toBe(one);
  });

  it('undo restores prior stickers', () => {
    const base = withCard();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: 'a' });
    s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: 'b' });
    s = applyAction(s, { type: 'UNDO' });
    expect(s.battlefield[0].stickers).toEqual(['a']);
    s = applyAction(s, { type: 'REMOVE_STICKER', cardId: id, index: 0 });
    expect(s.battlefield[0].stickers).toEqual([]);
    s = applyAction(s, { type: 'UNDO' });
    expect(s.battlefield[0].stickers).toEqual(['a']);
  });

  it('snapshots do not alias sticker arrays', () => {
    const base = withCard();
    const { id } = base;
    let s = base.s;
    s = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: 'a' });
    const next = applyAction(s, { type: 'ADD_STICKER', cardId: id, text: 'b' });
    // Mutating the new state's array must not leak into the snapshot in past.
    next.battlefield[0].stickers.push('evil');
    expect(next.past[0].battlefield[0].stickers).toEqual(['a']);
    expect(s.battlefield[0].stickers).toEqual(['a']);
  });
});

describe('CREATE_TOKEN', () => {
  it('adds a token directly onto the battlefield and forces isToken=true', () => {
    const s = init(10, 1, 0);
    const next = applyAction(s, {
      type: 'CREATE_TOKEN',
      card: { id: 'tok', name: 'Treasure' },
      x: 50,
      y: 50,
    });
    expect(next.battlefield).toHaveLength(1);
    expect(next.battlefield[0].card.isToken).toBe(true);
  });
});

describe('NEXT_TURN', () => {
  it('increments turn, untaps all, and draws one', () => {
    let s = init(20, 1, 3);
    const id = s.zones.hand[0].id;
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: id, x: 0, y: 0, tapped: true });
    const libBefore = s.zones.library.length;
    const next = applyAction(s, { type: 'NEXT_TURN' });
    expect(next.turn).toBe(2);
    expect(next.battlefield[0].tapped).toBe(false);
    expect(next.zones.library).toHaveLength(libBefore - 1);
    expect(next.zones.hand.length).toBe(s.zones.hand.length + 1);
  });

  it('still advances turn when the library is empty', () => {
    let s = init(7, 1, 7);
    s = applyAction(s, { type: 'NEXT_TURN' });
    expect(s.turn).toBe(2);
  });
});

describe('UNDO', () => {
  it('reverts a single action', () => {
    const s = init(20, 1, 3);
    const next = applyAction(s, { type: 'DRAW', n: 2 });
    const undone = applyAction(next, { type: 'UNDO' });
    expect(undone.zones.hand.map((c) => c.id)).toEqual(s.zones.hand.map((c) => c.id));
    expect(undone.zones.library.map((c) => c.id)).toEqual(s.zones.library.map((c) => c.id));
  });

  it('is a no-op when history is empty', () => {
    const s = init(20, 1, 3);
    const next = applyAction(s, { type: 'UNDO' });
    expect(next).toBe(s);
  });

  it('can unwind several actions in reverse order', () => {
    let s = init(20, 1, 3);
    const id = s.zones.hand[0].id;
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: id, x: 0, y: 0 });
    s = applyAction(s, { type: 'TAP', cardId: id, tapped: true });
    s = applyAction(s, { type: 'SET_COUNTER', cardId: id, counter: '+1/+1', delta: 1 });
    s = applyAction(s, { type: 'UNDO' });
    expect(s.battlefield[0].counters['+1/+1']).toBeUndefined();
    expect(s.battlefield[0].tapped).toBe(true);
    s = applyAction(s, { type: 'UNDO' });
    expect(s.battlefield[0].tapped).toBe(false);
    s = applyAction(s, { type: 'UNDO' });
    expect(s.battlefield).toHaveLength(0);
  });

  it('caps the undo stack at 50', () => {
    let s = init(60, 1, 0);
    for (let i = 0; i < 60; i++) s = applyAction(s, { type: 'DRAW', n: 1 });
    expect(s.past.length).toBe(50);
  });
});

describe('RESET', () => {
  it('clears battlefield, exile, graveyard and reshuffles non-tokens back into the library', () => {
    let s = init(10, 1, 3);
    const handId = s.zones.hand[0].id;
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: handId, x: 0, y: 0 });
    s = applyAction(s, { type: 'CREATE_TOKEN', card: { id: 'tok', name: 'T' }, x: 0, y: 0 });
    s = applyAction(s, { type: 'RESET' });
    expect(s.battlefield).toHaveLength(0);
    expect(s.zones.hand).toHaveLength(7);
    expect(s.zones.graveyard).toHaveLength(0);
    expect(s.zones.exile).toHaveLength(0);
    expect(s.turn).toBe(1);
    expect(s.past).toEqual([]);
    // Token cards do not return to the library.
    expect(s.zones.library.find((c) => c.id === 'tok')).toBeUndefined();
  });

  it('preserves the command zone across RESET', () => {
    const cmdr = card('cmdr', { name: 'Atraxa' });
    let s = createPlaytestState({ library: deck(20), command: [cmdr], seed: 1 });
    s = applyAction(s, { type: 'RESET' });
    expect(s.zones.command).toEqual([cmdr]);
  });
});

describe('card conservation', () => {
  it('non-token card count is preserved across arbitrary action sequences', () => {
    let s = init(20, 7, 3);
    const initialIds = allCardIds(s);
    s = applyAction(s, { type: 'DRAW', n: 2 });
    const id1 = s.zones.hand[0].id;
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: id1, x: 0, y: 0 });
    s = applyAction(s, { type: 'TAP', cardId: id1 });
    s = applyAction(s, { type: 'MOVE_TO_ZONE', cardId: id1, to: 'graveyard' });
    s = applyAction(s, { type: 'SHUFFLE_LIBRARY' });
    s = applyAction(s, { type: 'NEXT_TURN' });
    expect(allCardIds(s)).toEqual(initialIds);
  });
});
