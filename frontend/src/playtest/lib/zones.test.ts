import { describe, expect, it } from 'vitest';
import { applyAction, createPlaytestState } from '@/lib/playtest';
import type { PlaytestCard } from '@/lib/playtest';
import { zoneDropIndex } from './zones';

describe('zoneDropIndex — where a dropped card lands', () => {
  it('puts a card dropped on the library on TOP', () => {
    // The library is drawn from index 0, so appending would bury the card
    // under the whole deck — invisible, and not what "put it back" means.
    expect(zoneDropIndex('library')).toBe(0);
  });

  it('appends everywhere else, because their top IS the last card in', () => {
    for (const zone of ['graveyard', 'exile', 'hand', 'command'] as const) {
      expect(zoneDropIndex(zone), zone).toBeUndefined();
    }
  });
});

describe('a card put back into the library', () => {
  function stateWithLibrary() {
    const library: PlaytestCard[] = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      name: `Card ${id}`,
    }));
    // Fixed seed and a one-card opening hand: the order has to be knowable
    // for "is it the next card drawn" to mean anything.
    return createPlaytestState({ library, seed: 7, openingHandSize: 1 });
  }

  it('is the very next card drawn, not buried under the deck', () => {
    // The whole point of putting a card on top. Drawn first, then the card
    // that WAS on top — so the deck below is undisturbed.
    let s = stateWithLibrary();
    const drawn = s.zones.library[0];
    s = applyAction(s, { type: 'DRAW' });
    const inHand = s.zones.hand[s.zones.hand.length - 1];
    expect(inHand.id).toBe(drawn.id);

    s = applyAction(s, {
      type: 'MOVE_TO_ZONE',
      cardId: inHand.id,
      to: 'library',
      toIndex: zoneDropIndex('library'),
    });
    expect(s.zones.library[0].id).toBe(inHand.id);

    s = applyAction(s, { type: 'DRAW' });
    expect(s.zones.hand[s.zones.hand.length - 1].id).toBe(inHand.id);
  });

  it('goes to the BOTTOM when that is what was asked for', () => {
    // The card menu's "Library (bottom)" passes no index, which the reducer
    // reads as "the end" — the drop default must not take that away.
    let s = stateWithLibrary();
    s = applyAction(s, { type: 'DRAW' });
    const inHand = s.zones.hand[s.zones.hand.length - 1];
    s = applyAction(s, { type: 'MOVE_TO_ZONE', cardId: inHand.id, to: 'library' });
    expect(s.zones.library[s.zones.library.length - 1].id).toBe(inHand.id);
  });
});
