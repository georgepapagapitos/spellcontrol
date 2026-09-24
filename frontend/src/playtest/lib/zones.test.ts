import { describe, expect, it } from 'vitest';
import { applyAction, createPlaytestState } from '@/lib/playtest';
import type { PlaytestCard } from '@/lib/playtest';
import { taxCommanders, zoneDropIndex } from './zones';

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
    // The card menu's "Library bottom" passes no index, which the reducer
    // reads as "the end" — the drop default must not take that away.
    let s = stateWithLibrary();
    s = applyAction(s, { type: 'DRAW' });
    const inHand = s.zones.hand[s.zones.hand.length - 1];
    s = applyAction(s, { type: 'MOVE_TO_ZONE', cardId: inHand.id, to: 'library' });
    expect(s.zones.library[s.zones.library.length - 1].id).toBe(inHand.id);
  });
});

describe('taxCommanders — whose tax the coins track', () => {
  const cmd = (id: string): PlaytestCard => ({ id, name: id, origin: 'command' });

  function withCommand(command: PlaytestCard[]) {
    const s = createPlaytestState({
      library: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: `C${i}` })),
      command,
    });
    return s;
  }

  it('puts the deck’s commander first and its partner second, whatever the ids', () => {
    const s = withCommand([cmd('cmd-z'), cmd('cmd-a')]);
    expect(taxCommanders(s, ['cmd-z', 'cmd-a']).map((c) => c.id)).toEqual(['cmd-z', 'cmd-a']);
  });

  it('keeps tracking a commander on the battlefield, in the same place', () => {
    let s = withCommand([cmd('cmd-a'), cmd('cmd-b')]);
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: 'cmd-a', x: 0, y: 0 });
    expect(taxCommanders(s).map((c) => c.id)).toEqual(['cmd-a', 'cmd-b']);
  });

  it('gives a card put in the command zone by hand a coin while it is there', () => {
    let s = withCommand([]);
    expect(taxCommanders(s)).toEqual([]);
    s = applyAction(s, { type: 'MOVE_TO_ZONE', cardId: 'c0', to: 'command' });
    expect(taxCommanders(s).map((c) => c.id)).toEqual(['c0']);
  });

  it('draws two coins at most', () => {
    const s = withCommand([cmd('a'), cmd('b'), cmd('c')]);
    expect(taxCommanders(s)).toHaveLength(2);
  });
});
