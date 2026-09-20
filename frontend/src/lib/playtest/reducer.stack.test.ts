import { describe, expect, it } from 'vitest';
import { applyAction, createPlaytestState } from './reducer';
import type { PlaytestCard, PlaytestState } from './types';

function card(id: string, over: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id, name: `card-${id}`, ...over };
}

function init(cards: PlaytestCard[], handSize = 2): PlaytestState {
  return createPlaytestState({ library: cards, seed: 7, openingHandSize: handSize });
}

/** Put a specific card in hand regardless of the shuffle. */
function withHand(cards: PlaytestCard[]): PlaytestState {
  const s = init(cards, 0);
  return { ...s, zones: { ...s.zones, hand: s.zones.library.slice(), library: [] } };
}

function onBattlefield(c: PlaytestCard): PlaytestState {
  const s = withHand([c]);
  return applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: c.id, x: 0.5, y: 0.5 });
}

describe('PUT_ON_STACK', () => {
  it('moves the card out of its zone and onto the stack', () => {
    const s = applyAction(withHand([card('a', { typeLine: 'Instant' })]), {
      type: 'PUT_ON_STACK',
      cardId: 'a',
      entryId: 'e1',
    });
    expect(s.zones.hand).toHaveLength(0);
    expect(s.stack).toHaveLength(1);
    expect(s.stack![0]).toMatchObject({ id: 'e1', isCopy: false, from: 'hand' });
  });

  it('a copy leaves the real card exactly where it was', () => {
    const s = applyAction(onBattlefield(card('a', { typeLine: 'Creature' })), {
      type: 'PUT_ON_STACK',
      cardId: 'a',
      entryId: 'e1',
      copy: true,
    });
    expect(s.battlefield).toHaveLength(1);
    expect(s.stack![0]).toMatchObject({ isCopy: true });
    expect(s.stack![0].from).toBeUndefined();
  });

  it('refuses to put the same real card on the stack twice', () => {
    const once = applyAction(withHand([card('a')]), {
      type: 'PUT_ON_STACK',
      cardId: 'a',
      entryId: 'e1',
    });
    const twice = applyAction(once, { type: 'PUT_ON_STACK', cardId: 'a', entryId: 'e2' });
    expect(twice).toBe(once);
  });

  it('is a no-op for a card that is nowhere', () => {
    const s = withHand([card('a')]);
    expect(applyAction(s, { type: 'PUT_ON_STACK', cardId: 'nope', entryId: 'e1' })).toBe(s);
  });
});

describe('RESOLVE_STACK', () => {
  it('puts a permanent onto the battlefield at the given spot', () => {
    const s = applyAction(
      applyAction(withHand([card('a', { typeLine: 'Creature — Bear' })]), {
        type: 'PUT_ON_STACK',
        cardId: 'a',
        entryId: 'e1',
      }),
      { type: 'RESOLVE_STACK', x: 0.25, y: 0.75 }
    );
    expect(s.stack).toHaveLength(0);
    expect(s.battlefield).toHaveLength(1);
    expect(s.battlefield[0]).toMatchObject({ x: 0.25, y: 0.75, tapped: false });
  });

  it('sends an instant or sorcery to the graveyard', () => {
    const s = applyAction(
      applyAction(withHand([card('a', { typeLine: 'Instant' })]), {
        type: 'PUT_ON_STACK',
        cardId: 'a',
        entryId: 'e1',
      }),
      { type: 'RESOLVE_STACK' }
    );
    expect(s.battlefield).toHaveLength(0);
    expect(s.zones.graveyard.map((c) => c.id)).toEqual(['a']);
  });

  // Rule 707.10: a copy ceases to exist as it resolves.
  it('a resolving copy goes nowhere at all', () => {
    const s = applyAction(
      applyAction(onBattlefield(card('a', { typeLine: 'Creature' })), {
        type: 'PUT_ON_STACK',
        cardId: 'a',
        entryId: 'e1',
        copy: true,
      }),
      { type: 'RESOLVE_STACK' }
    );
    expect(s.stack).toHaveLength(0);
    expect(s.battlefield).toHaveLength(1);
    expect(s.zones.graveyard).toHaveLength(0);
  });

  it('returns a commander cast from the command zone to the command zone', () => {
    const base = withHand([card('cmd', { typeLine: 'Instant' })]);
    const inCommand: PlaytestState = {
      ...base,
      zones: { ...base.zones, hand: [], command: base.zones.hand.slice() },
    };
    const s = applyAction(
      applyAction(inCommand, { type: 'PUT_ON_STACK', cardId: 'cmd', entryId: 'e1' }),
      { type: 'RESOLVE_STACK' }
    );
    expect(s.zones.command.map((c) => c.id)).toEqual(['cmd']);
    expect(s.zones.graveyard).toHaveLength(0);
  });

  it('resolves the top — the last one put on — when no entry is named', () => {
    let s = withHand([card('a', { typeLine: 'Instant' }), card('b', { typeLine: 'Instant' })]);
    s = applyAction(s, { type: 'PUT_ON_STACK', cardId: 'a', entryId: 'e1' });
    s = applyAction(s, { type: 'PUT_ON_STACK', cardId: 'b', entryId: 'e2' });
    s = applyAction(s, { type: 'RESOLVE_STACK' });
    expect(s.zones.graveyard.map((c) => c.id)).toEqual(['b']);
    expect(s.stack!.map((e) => e.id)).toEqual(['e1']);
  });
});

describe('REMOVE_FROM_STACK', () => {
  it('a countered spell goes to the graveyard by default', () => {
    const s = applyAction(
      applyAction(withHand([card('a', { typeLine: 'Creature' })]), {
        type: 'PUT_ON_STACK',
        cardId: 'a',
        entryId: 'e1',
      }),
      { type: 'REMOVE_FROM_STACK', entryId: 'e1' }
    );
    expect(s.battlefield).toHaveLength(0);
    expect(s.zones.graveyard.map((c) => c.id)).toEqual(['a']);
  });

  it('honours an explicit destination', () => {
    const s = applyAction(
      applyAction(withHand([card('a')]), { type: 'PUT_ON_STACK', cardId: 'a', entryId: 'e1' }),
      { type: 'REMOVE_FROM_STACK', entryId: 'e1', to: 'hand' }
    );
    expect(s.zones.hand.map((c) => c.id)).toEqual(['a']);
  });
});

// The stack is reachable by the ordinary zone machinery, which is what lets
// a countered spell move with a plain MOVE_TO_ZONE instead of every caller
// having to know it was mid-resolution.
describe('a card on the stack is still locatable', () => {
  it('MOVE_TO_ZONE pulls it straight off', () => {
    const s = applyAction(
      applyAction(withHand([card('a')]), { type: 'PUT_ON_STACK', cardId: 'a', entryId: 'e1' }),
      { type: 'MOVE_TO_ZONE', cardId: 'a', to: 'exile' }
    );
    expect(s.stack).toHaveLength(0);
    expect(s.zones.exile.map((c) => c.id)).toEqual(['a']);
  });
});

describe('RESET', () => {
  it('shuffles a card left on the stack back into the deck rather than losing it', () => {
    const s = applyAction(
      applyAction(withHand([card('a'), card('b')]), {
        type: 'PUT_ON_STACK',
        cardId: 'a',
        entryId: 'e1',
      }),
      { type: 'RESET' }
    );
    expect(s.stack).toEqual([]);
    const all = [...s.zones.library, ...s.zones.hand].map((c) => c.id).sort();
    expect(all).toEqual(['a', 'b']);
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

  // "Add one to every counter" has no answer on a card with none — creating
  // a +1/+1 here would quietly make Ctrl+1 a pump spell.
  it('never invents a counter on a card that has none', () => {
    const s = onBattlefield(card('a'));
    expect(applyAction(s, { type: 'ADJUST_ALL_COUNTERS', cardId: 'a', op: 'inc' })).toBe(s);
  });
});
