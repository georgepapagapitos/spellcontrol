import { describe, expect, it } from 'vitest';
import { applyAction, createPlaytestState } from './reducer';
import type { PlaytestCard, PlaytestState } from './types';

function card(id: string, over: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id, name: `card-${id}`, ...over };
}

/** A state with exactly `cards` in hand and nothing else. */
function withHand(cards: PlaytestCard[]): PlaytestState {
  const s = createPlaytestState({ library: cards, seed: 7, openingHandSize: 0 });
  return { ...s, zones: { ...s.zones, hand: s.zones.library.slice(), library: [] } };
}

function onBattlefield(...cards: PlaytestCard[]): PlaytestState {
  let s = withHand(cards);
  for (const c of cards) {
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: c.id, x: 0.5, y: 0.5 });
  }
  return s;
}

function stacked(...cards: PlaytestCard[]): PlaytestState {
  let s = onBattlefield(...cards);
  for (const c of cards) s = applyAction(s, { type: 'PUT_ON_STACK', cardId: c.id });
  return s;
}

describe('PUT_ON_STACK', () => {
  // The whole model in one assertion: being on the stack is a MARK on a card
  // that is already in play, not a zone that takes it away.
  it('marks a permanent without moving it', () => {
    const s = stacked(card('a', { typeLine: 'Creature' }));
    expect(s.stack).toEqual(['a']);
    expect(s.battlefield).toHaveLength(1);
    expect(s.battlefield[0].card.id).toBe('a');
    expect(s.battlefield[0].x).toBe(0.5);
  });

  it('keeps counters, position and tapped state across being stacked', () => {
    let s = onBattlefield(card('a'));
    s = applyAction(s, { type: 'SET_COUNTER', cardId: 'a', counter: '+1/+1', delta: 2 });
    s = applyAction(s, { type: 'TAP', cardId: 'a' });
    s = applyAction(s, { type: 'PUT_ON_STACK', cardId: 'a' });
    expect(s.battlefield[0].counters).toEqual({ '+1/+1': 2 });
    expect(s.battlefield[0].tapped).toBe(true);
  });

  it('stacks in order, so the last one put on is the top', () => {
    const s = stacked(card('a'), card('b'), card('c'));
    expect(s.stack).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op for a card already on the stack', () => {
    const once = stacked(card('a'));
    expect(applyAction(once, { type: 'PUT_ON_STACK', cardId: 'a' })).toBe(once);
  });

  // The stack only ever names permanents in play — the UI plays a hand card
  // first, so the reducer never has to invent a position.
  it('is a no-op for a card that is not on the battlefield', () => {
    const s = withHand([card('a')]);
    expect(applyAction(s, { type: 'PUT_ON_STACK', cardId: 'a' })).toBe(s);
    expect(applyAction(s, { type: 'PUT_ON_STACK', cardId: 'nope' })).toBe(s);
  });
});

describe('RESOLVE_STACK', () => {
  it('unmarks a permanent and leaves it exactly where it was', () => {
    const s = applyAction(stacked(card('a', { typeLine: 'Creature — Bear' })), {
      type: 'RESOLVE_STACK',
    });
    expect(s.stack).toEqual([]);
    expect(s.battlefield).toHaveLength(1);
    expect(s.battlefield[0].x).toBe(0.5);
  });

  it('sends a resolving instant or sorcery to the graveyard', () => {
    const s = applyAction(stacked(card('a', { typeLine: 'Instant' })), { type: 'RESOLVE_STACK' });
    expect(s.stack).toEqual([]);
    expect(s.battlefield).toHaveLength(0);
    expect(s.zones.graveyard.map((c) => c.id)).toEqual(['a']);
  });

  // Rule 707.10 — a token copy ceases to exist rather than hitting a
  // graveyard it was never a card in.
  it('a resolving token spell-copy ceases to exist', () => {
    const s = applyAction(stacked(card('a', { typeLine: 'Instant', isToken: true })), {
      type: 'RESOLVE_STACK',
    });
    expect(s.battlefield).toHaveLength(0);
    expect(s.zones.graveyard).toHaveLength(0);
  });

  it('resolves the top — the last one put on — when no card is named', () => {
    const s = applyAction(stacked(card('a'), card('b')), { type: 'RESOLVE_STACK' });
    expect(s.stack).toEqual(['a']);
  });

  it('resolves a named card out of the middle', () => {
    const s = applyAction(stacked(card('a'), card('b'), card('c')), {
      type: 'RESOLVE_STACK',
      cardId: 'b',
    });
    expect(s.stack).toEqual(['a', 'c']);
  });

  it('is a no-op on an empty stack, or for a card that is not on it', () => {
    const empty = onBattlefield(card('a'));
    expect(applyAction(empty, { type: 'RESOLVE_STACK' })).toBe(empty);
    const one = stacked(card('a'), card('b'));
    expect(applyAction(one, { type: 'RESOLVE_STACK', cardId: 'nope' })).toBe(one);
  });
});

// The list names permanents in play, so it must never outlive the card it
// points at — otherwise the panel renders a row with nothing behind it.
describe('a card leaving the battlefield drops off the stack', () => {
  it('when it is moved to another zone', () => {
    const s = applyAction(stacked(card('a'), card('b')), {
      type: 'MOVE_TO_ZONE',
      cardId: 'a',
      to: 'graveyard',
    });
    expect(s.stack).toEqual(['b']);
    expect(s.zones.graveyard.map((c) => c.id)).toEqual(['a']);
  });

  it('when a token leaves and ceases to exist', () => {
    const s = applyAction(stacked(card('t', { isToken: true })), {
      type: 'MOVE_TO_ZONE',
      cardId: 't',
      to: 'exile',
    });
    expect(s.stack).toEqual([]);
    expect(s.zones.exile).toHaveLength(0);
  });

  it('and RESET clears the stack outright', () => {
    const s = applyAction(stacked(card('a')), { type: 'RESET' });
    expect(s.stack).toEqual([]);
  });
});

describe('UNDO', () => {
  it('restores the stack as it was', () => {
    const before = stacked(card('a'), card('b'));
    const after = applyAction(before, { type: 'RESOLVE_STACK' });
    expect(after.stack).toEqual(['a']);
    expect(applyAction(after, { type: 'UNDO' }).stack).toEqual(['a', 'b']);
  });
});

describe('TOGGLE_REVEAL', () => {
  it('shows and stops showing a card in hand', () => {
    const base = withHand([card('a')]);
    const shown = applyAction(base, { type: 'TOGGLE_REVEAL', cardId: 'a' });
    expect(shown.revealed).toEqual(['a']);
    expect(applyAction(shown, { type: 'TOGGLE_REVEAL', cardId: 'a' }).revealed).toEqual([]);
  });

  it('is a no-op for a card that is not in hand', () => {
    const s = onBattlefield(card('a'));
    expect(applyAction(s, { type: 'TOGGLE_REVEAL', cardId: 'a' })).toBe(s);
  });

  // A revealed card that leaves hand must stop being listed, or the
  // projection would keep naming a card that isn't there to be shown.
  it('drops the reveal when the card leaves hand', () => {
    const shown = applyAction(withHand([card('a')]), { type: 'TOGGLE_REVEAL', cardId: 'a' });
    const played = applyAction(shown, { type: 'MOVE_TO_ZONE', cardId: 'a', to: 'graveyard' });
    expect(played.revealed).toEqual([]);
  });
});

describe('ADJUST_PT', () => {
  it('accumulates a modifier', () => {
    let s = onBattlefield(card('a'));
    s = applyAction(s, { type: 'ADJUST_PT', cardId: 'a', power: 2, toughness: 1 });
    s = applyAction(s, { type: 'ADJUST_PT', cardId: 'a', power: 1 });
    expect(s.battlefield[0].pt).toEqual({ power: 3, toughness: 1 });
  });

  it('drops the field entirely once the modifier is back to nothing', () => {
    let s = onBattlefield(card('a'));
    s = applyAction(s, { type: 'ADJUST_PT', cardId: 'a', power: 2 });
    s = applyAction(s, { type: 'ADJUST_PT', cardId: 'a', power: -2 });
    expect(s.battlefield[0].pt).toBeUndefined();
  });

  it('is a no-op for a zero step', () => {
    const s = onBattlefield(card('a'));
    expect(applyAction(s, { type: 'ADJUST_PT', cardId: 'a', power: 0 })).toBe(s);
  });
});

describe('ADJUST_ALL_COUNTERS', () => {
  function withCounters(): PlaytestState {
    let s = onBattlefield(card('a'));
    s = applyAction(s, { type: 'SET_COUNTER', cardId: 'a', counter: '+1/+1', delta: 3 });
    s = applyAction(s, { type: 'SET_COUNTER', cardId: 'a', counter: 'charge', delta: 1 });
    return s;
  }

  it('steps every kind up', () => {
    const s = applyAction(withCounters(), { type: 'ADJUST_ALL_COUNTERS', cardId: 'a', op: 'inc' });
    expect(s.battlefield[0].counters).toEqual({ '+1/+1': 4, charge: 2 });
  });

  it('doubles every kind', () => {
    const s = applyAction(withCounters(), {
      type: 'ADJUST_ALL_COUNTERS',
      cardId: 'a',
      op: 'double',
    });
    expect(s.battlefield[0].counters).toEqual({ '+1/+1': 6, charge: 2 });
  });

  it('drops a kind that steps down to zero', () => {
    const s = applyAction(withCounters(), { type: 'ADJUST_ALL_COUNTERS', cardId: 'a', op: 'dec' });
    expect(s.battlefield[0].counters).toEqual({ '+1/+1': 2 });
  });

  it('removes every kind at once', () => {
    const s = applyAction(withCounters(), {
      type: 'ADJUST_ALL_COUNTERS',
      cardId: 'a',
      op: 'clear',
    });
    expect(s.battlefield[0].counters).toEqual({});
  });

  // "Add one to every counter" has no answer on a card with none — creating
  // a +1/+1 here would quietly make Ctrl+1 a pump spell.
  it('never invents a counter on a card that has none', () => {
    const s = onBattlefield(card('a'));
    expect(applyAction(s, { type: 'ADJUST_ALL_COUNTERS', cardId: 'a', op: 'inc' })).toBe(s);
  });
});
