import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaytestCard } from '@/lib/playtest';
import { usePlaytestStore } from './store';
import { createResistanceState, resistanceRespond } from './lib/resistance';

const threatTemplate = {
  name: 'Ulamog, the Ceaseless Hunger',
  manaValue: 10,
  typeLine: 'Legendary Creature — Eldrazi',
};

/** A library of identical big threats so any opening-hand card is threatening. */
function threatLibrary(n = 12): PlaytestCard[] {
  return Array.from({ length: n }, (_, i) => ({ id: `threat-${i}`, ...threatTemplate }));
}

/**
 * Find a resistance seed whose first roll against a big threat produces the
 * given effect — programmatic, so the test carries no brittle magic numbers.
 */
function findSeedFor(effect: 'counter' | 'bounce'): number {
  const probe: PlaytestCard = { id: 'probe', ...threatTemplate };
  for (let seed = 1; seed <= 10000; seed++) {
    const { response } = resistanceRespond(
      createResistanceState(seed),
      { kind: 'played', card: probe },
      { battlefield: [] }
    );
    if (response?.effect === effect) return seed;
  }
  throw new Error(`no seed in 1..10000 triggers a ${effect}`);
}

function store() {
  return usePlaytestStore.getState();
}

beforeEach(() => {
  store().teardown();
});

describe('playtest store — resistance mode', () => {
  it('toggles on with a seeded opponent and off clean', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    expect(store().resistance).toBe(false);

    store().toggleResistance();
    expect(store().resistance).toBe(true);
    // Seeded from the deterministic game rngSeed, not wall clock.
    expect(store().resistanceState).toEqual(createResistanceState(store().state!.rngSeed));

    store().toggleResistance();
    expect(store().resistance).toBe(false);
    expect(store().resistanceState).toBeNull();
    expect(store().lastResistanceEvent).toBeNull();
  });

  it('counters a threatening play: card goes to graveyard and the banner event fires', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().toggleResistance();
    // Pin the opponent to a seed known (found programmatically) to counter.
    usePlaytestStore.setState({ resistanceState: createResistanceState(findSeedFor('counter')) });

    const played = store().state!.zones.hand[0];
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: played.id, x: 10, y: 10 });

    const s = store().state!;
    expect(s.battlefield).toHaveLength(0);
    expect(s.zones.graveyard.map((c) => c.id)).toEqual([played.id]);
    expect(store().lastResistanceEvent).toEqual({
      id: 1,
      message: expect.stringContaining(`${played.name} is countered`),
    });
    expect(store().lastResistanceEvent!.message).toMatch(/^Opponent casts /);
    expect(store().resistanceState!.respondedThisTurn).toBe(true);
  });

  it('bounces return the card to hand', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().toggleResistance();
    usePlaytestStore.setState({ resistanceState: createResistanceState(findSeedFor('bounce')) });

    const played = store().state!.zones.hand[0];
    const handBefore = store().state!.zones.hand.length;
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: played.id, x: 10, y: 10 });

    const s = store().state!;
    expect(s.battlefield).toHaveLength(0);
    expect(s.zones.hand).toHaveLength(handBefore); // left hand, then bounced back
    expect(s.zones.hand.some((c) => c.id === played.id)).toBe(true);
    expect(store().lastResistanceEvent?.message).toContain('is returned to hand');
  });

  it('the opponent response is undoable per-move', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().toggleResistance();
    const pinned = createResistanceState(findSeedFor('counter'));
    usePlaytestStore.setState({ resistanceState: pinned });

    const played = store().state!.zones.hand[0];
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: played.id, x: 10, y: 10 });
    expect(store().state!.zones.graveyard).toHaveLength(1);
    expect(store().resistanceState!.respondedThisTurn).toBe(true);

    // First undo reverses the opponent's graveyard move (card back on board)
    // AND rewinds the response bookkeeping — visually no response happened,
    // so the flags and seed must agree.
    store().dispatch({ type: 'UNDO' });
    expect(store().state!.battlefield.map((b) => b.card.id)).toEqual([played.id]);
    expect(store().resistanceState).toEqual(pinned);
    // …second undo reverses the play itself.
    store().dispatch({ type: 'UNDO' });
    expect(store().state!.zones.hand.some((c) => c.id === played.id)).toBe(true);
    expect(store().resistanceState).toEqual(pinned);

    // Deterministic replay: the same play re-rolls the same counter.
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: played.id, x: 10, y: 10 });
    expect(store().state!.zones.graveyard.map((c) => c.id)).toEqual([played.id]);
  });

  it('fully undoing the board wipe re-arms it; a partial undo does not', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().toggleResistance();
    // Battlefield of 5 wipe targets, and a seed whose turn-start roll wipes.
    const board = threatLibrary(5).map((card, i) => ({
      card: { ...card, id: `bf-${i}` },
      tapped: false,
      counters: {},
      stickers: [],
      x: 10,
      y: 10,
      faceDown: false,
    }));
    let wipeSeed = 0;
    for (let seed = 1; seed <= 10000 && !wipeSeed; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 2 },
        { battlefield: board }
      );
      if (response?.effect === 'wipe') wipeSeed = seed;
    }
    expect(wipeSeed).toBeGreaterThan(0);
    usePlaytestStore.setState({
      state: { ...store().state!, battlefield: board },
      resistanceState: createResistanceState(wipeSeed),
    });

    store().dispatch({ type: 'NEXT_TURN' });
    expect(store().state!.battlefield).toHaveLength(0);
    expect(store().resistanceState!.wipeUsed).toBe(true);

    // Undo one wiped permanent: the wipe stays spent (no free claw-back).
    store().dispatch({ type: 'UNDO' });
    expect(store().state!.battlefield).toHaveLength(1);
    expect(store().resistanceState!.wipeUsed).toBe(true);

    // Undo the remaining four moves: board fully restored, wipe re-armed.
    for (let i = 0; i < 4; i++) store().dispatch({ type: 'UNDO' });
    expect(store().state!.battlefield).toHaveLength(5);
    expect(store().resistanceState!.wipeUsed).toBe(false);
  });

  it('a dismissed banner id from a previous game never swallows the next announcement', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().toggleResistance();
    usePlaytestStore.setState({ resistanceState: createResistanceState(findSeedFor('counter')) });
    const first = store().state!.zones.hand[0];
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: first.id, x: 5, y: 5 });
    const firstId = store().lastResistanceEvent!.id;

    store().dispatch({ type: 'RESET' });
    usePlaytestStore.setState({ resistanceState: createResistanceState(findSeedFor('counter')) });
    const second = store().state!.zones.hand[0];
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: second.id, x: 5, y: 5 });
    // Ids keep counting across RESET, so `dismissedResistanceId === firstId`
    // in the (unremounted) board component can't hide this one.
    expect(store().lastResistanceEvent!.id).toBeGreaterThan(firstId);
  });

  it('disabled → plays resolve untouched and no event fires', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    const played = store().state!.zones.hand[0];
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: played.id, x: 10, y: 10 });

    expect(store().state!.battlefield.map((b) => b.card.id)).toEqual([played.id]);
    expect(store().state!.zones.graveyard).toHaveLength(0);
    expect(store().lastResistanceEvent).toBeNull();
  });

  it('non-play actions (draw, tap) never trigger responses', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().toggleResistance();
    usePlaytestStore.setState({ resistanceState: createResistanceState(findSeedFor('counter')) });

    store().dispatch({ type: 'DRAW', n: 1 });
    expect(store().lastResistanceEvent).toBeNull();
    // The opponent seed is untouched — DRAW derived no resistance event.
    expect(store().resistanceState).toEqual(createResistanceState(findSeedFor('counter')));
  });

  it('event ids increment so identical messages still re-announce', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().toggleResistance();

    let fired = 0;
    // Identical cards, so repeated counters produce identical messages.
    for (let i = 0; i < 20 && fired < 2; i++) {
      usePlaytestStore.setState({ resistanceState: createResistanceState(findSeedFor('counter')) });
      const cardInHand = store().state!.zones.hand[0];
      if (!cardInHand) break;
      const before = store().lastResistanceEvent?.id ?? 0;
      store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: cardInHand.id, x: 5, y: 5 });
      const after = store().lastResistanceEvent?.id ?? 0;
      expect(after).toBe(before + 1);
      fired++;
      store().dispatch({ type: 'NEXT_TURN' }); // reset the per-turn budget
    }
    expect(fired).toBe(2);
  });

  it('RESET re-arms the opponent (fresh state, wipe available again)', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().toggleResistance();
    usePlaytestStore.setState({
      resistanceState: { seed: 9, wipeUsed: true, respondedThisTurn: true },
      lastResistanceEvent: { id: 3, message: 'old' },
    });

    store().dispatch({ type: 'RESET' });
    expect(store().resistance).toBe(true);
    expect(store().resistanceState).toEqual(createResistanceState(store().state!.rngSeed));
    expect(store().resistanceState!.wipeUsed).toBe(false);
    expect(store().lastResistanceEvent).toBeNull();
  });
});
