// @vitest-environment happy-dom
//
// happy-dom (not the suite default `node`) so the module-level pagehide/
// visibilitychange + debounced-snapshot wiring in `store.ts` — gated on
// `typeof window !== 'undefined'` — actually installs itself for the
// session-persistence tests below.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaytestCard, PlaytestState } from '@/lib/playtest';
import { usePlaytestStore, flushPendingPlaytestSnapshot } from './store';
import { createResistanceState, resistanceRespond, RESISTANCE_PRESETS } from './lib/resistance';
import { useDecksStore, type Deck } from '@/store/decks';
import { loadPlaytestSnapshot } from '@/lib/playtest/session-snapshot';
import { loadSessionHistory } from '@/lib/playtest/session-history';

const STANDARD = RESISTANCE_PRESETS.standard;

// The decks-store sync subscriber (E133) fire-and-forgets a dynamic
// `import('../lib/sync')` on every `decks` change; mock it the same way
// `store/decks.test.ts` does so seeding a deck here can't touch the network.
vi.mock('@/lib/sync', () => ({
  persistDecksState: vi.fn().mockResolvedValue(undefined),
}));

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 100,
    ...overrides,
  } as Deck;
}

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
 * given effect (under the standard preset) — programmatic, so the test
 * carries no brittle magic numbers.
 */
function findSeedFor(effect: 'counter' | 'bounce'): number {
  const probe: PlaytestCard = { id: 'probe', ...threatTemplate };
  for (let seed = 1; seed <= 10000; seed++) {
    const { response } = resistanceRespond(
      createResistanceState(seed),
      { kind: 'played', card: probe },
      { battlefield: [] },
      STANDARD
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
  it('sets a level with a seeded opponent, and off clears clean', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    expect(store().resistanceLevel).toBe('off');

    store().setResistanceLevel('standard');
    expect(store().resistanceLevel).toBe('standard');
    // Seeded from the deterministic game rngSeed, not wall clock.
    expect(store().resistanceState).toEqual(createResistanceState(store().state!.rngSeed));

    store().setResistanceLevel('off');
    expect(store().resistanceLevel).toBe('off');
    expect(store().resistanceState).toBeNull();
    expect(store().lastResistanceEvent).toBeNull();
  });

  it('switching directly between two armed levels re-arms a fresh opponent', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().setResistanceLevel('casual');
    usePlaytestStore.setState({
      resistanceState: { seed: 999, wipesUsed: 1, responsesThisTurn: 1 },
    });

    store().setResistanceLevel('ruthless');
    expect(store().resistanceLevel).toBe('ruthless');
    expect(store().resistanceState).toEqual(createResistanceState(store().state!.rngSeed));
  });

  it('remembers the last non-off level picked as a device preference', async () => {
    const { saveLastResistanceLevel, loadLastResistanceLevel } = await import('./lib/resistance');
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().setResistanceLevel('ruthless');
    expect(loadLastResistanceLevel()).toBe('ruthless');
    // Turning off doesn't clobber the remembered preference.
    store().setResistanceLevel('off');
    expect(loadLastResistanceLevel()).toBe('ruthless');
    saveLastResistanceLevel('casual');
    expect(loadLastResistanceLevel()).toBe('casual');
  });

  it('counters a threatening play: card goes to graveyard and the banner event fires', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().setResistanceLevel('standard');
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
    expect(store().resistanceState!.responsesThisTurn).toBe(1);
  });

  it('bounces return the card to hand', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().setResistanceLevel('standard');
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
    store().setResistanceLevel('standard');
    const pinned = createResistanceState(findSeedFor('counter'));
    usePlaytestStore.setState({ resistanceState: pinned });

    const played = store().state!.zones.hand[0];
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: played.id, x: 10, y: 10 });
    expect(store().state!.zones.graveyard).toHaveLength(1);
    expect(store().resistanceState!.responsesThisTurn).toBe(1);

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
    store().setResistanceLevel('standard');
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
        { battlefield: board },
        STANDARD
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
    expect(store().resistanceState!.wipesUsed).toBe(1);

    // Undo one wiped permanent: the wipe stays spent (no free claw-back).
    store().dispatch({ type: 'UNDO' });
    expect(store().state!.battlefield).toHaveLength(1);
    expect(store().resistanceState!.wipesUsed).toBe(1);

    // Undo the remaining four moves: board fully restored, wipe re-armed.
    for (let i = 0; i < 4; i++) store().dispatch({ type: 'UNDO' });
    expect(store().state!.battlefield).toHaveLength(5);
    expect(store().resistanceState!.wipesUsed).toBe(0);
  });

  it('a dismissed banner id from a previous game never swallows the next announcement', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().setResistanceLevel('standard');
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
    store().setResistanceLevel('standard');
    usePlaytestStore.setState({ resistanceState: createResistanceState(findSeedFor('counter')) });

    store().dispatch({ type: 'DRAW', n: 1 });
    expect(store().lastResistanceEvent).toBeNull();
    // The opponent seed is untouched — DRAW derived no resistance event.
    expect(store().resistanceState).toEqual(createResistanceState(findSeedFor('counter')));
  });

  it('event ids increment so identical messages still re-announce', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().setResistanceLevel('standard');

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
    store().setResistanceLevel('standard');
    usePlaytestStore.setState({
      resistanceState: { seed: 9, wipesUsed: 1, responsesThisTurn: 1 },
      lastResistanceEvent: { id: 3, message: 'old' },
    });

    store().dispatch({ type: 'RESET' });
    expect(store().resistanceLevel).toBe('standard');
    expect(store().resistanceState).toEqual(createResistanceState(store().state!.rngSeed));
    expect(store().resistanceState!.wipesUsed).toBe(0);
    expect(store().lastResistanceEvent).toBeNull();
  });
});

describe('hydrate (E137 resume)', () => {
  it('restores a saved session, resetting the undo stack and opponent history', () => {
    store().hydrate('deck-9', {
      fingerprint: '1:1',
      savedAt: 0,
      phase: 'playing',
      mulliganCount: 2,
      resistanceLevel: 'standard',
      resistanceState: createResistanceState(5),
      state: {
        zones: { library: [], hand: [], graveyard: [], exile: [], command: [] },
        battlefield: [],
        rngSeed: 5,
        turn: 4,
        commanderTax: {},
        life: 40,
        opponents: [{ life: 40, commanderDamage: 0 }],
        startingLife: 40,
        startingOpponentLife: 40,
        commanderDamageThreshold: 21,
        tableDefeatedTurn: null,
      },
      gameLog: [{ seq: 1, turn: 3, kind: 'draw', text: 'Drew 1 card' }],
    });

    expect(store().deckId).toBe('deck-9');
    expect(store().phase).toBe('playing');
    expect(store().mulliganCount).toBe(2);
    expect(store().resistanceLevel).toBe('standard');
    expect(store().resistanceState).toEqual(createResistanceState(5));
    expect(store().state?.turn).toBe(4);
    // The undo stack and per-entry opponent bookkeeping don't survive a
    // snapshot (too big to persist) — restore starts them clean.
    expect(store().state?.past).toEqual([]);
    expect(store().resistancePast).toEqual([]);
    expect(store().lastResistanceEvent).toBeNull();
    // The game log DOES survive a resume — it's the whole point of E140.
    expect(store().gameLog).toEqual([{ seq: 1, turn: 3, kind: 'draw', text: 'Drew 1 card' }]);
  });
});

describe('game log (E140 + E142)', () => {
  it('records structured entries for reducer actions dispatched through the store', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().dispatch({ type: 'NEXT_TURN' });
    expect(store().gameLog).toEqual([{ seq: 1, turn: 2, kind: 'turn', text: 'Turn 2 begins' }]);
  });

  it('RESET appends a marker entry rather than clearing the log', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().dispatch({ type: 'NEXT_TURN' });
    store().dispatch({ type: 'RESET' });
    expect(store().gameLog.map((e) => e.kind)).toEqual(['turn', 'reset']);
  });

  it('UNDO appends an "Undid last action" entry instead of rewinding the log', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().dispatch({ type: 'NEXT_TURN' });
    store().dispatch({ type: 'UNDO' });
    expect(store().gameLog.map((e) => ({ kind: e.kind, text: e.text }))).toEqual([
      { kind: 'turn', text: 'Turn 2 begins' },
      { kind: 'undo', text: 'Undid last action' },
    ]);
  });

  it('an UNDO with nothing to pop logs nothing', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().dispatch({ type: 'UNDO' });
    expect(store().gameLog).toEqual([]);
  });

  it('setResistanceLevel appends a level-change entry naming the new level', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().setResistanceLevel('ruthless');
    expect(store().gameLog).toHaveLength(1);
    expect(store().gameLog[0].kind).toBe('resistance');
    expect(store().gameLog[0].text).toContain('Ruthless');

    store().setResistanceLevel('off');
    expect(store().gameLog).toHaveLength(2);
    expect(store().gameLog[1].text).toContain('Off');
  });

  it('logs both the play and the opponent response, in order, when Resistance fires', () => {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().setResistanceLevel('standard');
    usePlaytestStore.setState({ resistanceState: createResistanceState(findSeedFor('counter')) });
    const played = store().state!.zones.hand[0];
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: played.id, x: 10, y: 10 });

    const log = store().gameLog;
    // [0] the "Resistance: Standard" level-change entry, [1] the play, [2] the response.
    expect(log).toHaveLength(3);
    expect(log[0].kind).toBe('resistance');
    expect(log[1].kind).toBe('play');
    expect(log[2].kind).toBe('resistance');
    // The log entry is the banner message verbatim — same durable record.
    expect(log[2].text).toBe(store().lastResistanceEvent!.message);
  });

  it('logScryPeek appends a scry entry at the current turn', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().logScryPeek();
    expect(store().gameLog).toEqual([
      { seq: 1, turn: 1, kind: 'scry', text: 'Peeked at the top of the library' },
    ]);
  });

  it('mulliganOpeningHand logs a mulligan entry', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().mulliganOpeningHand();
    expect(store().gameLog).toEqual([
      {
        seq: 1,
        turn: 1,
        kind: 'mulligan',
        text: `Mulliganed to ${store().state!.zones.hand.length}`,
      },
    ]);
  });

  it('caps at 500 entries, dropping the oldest', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    for (let i = 0; i < 510; i++) store().dispatch({ type: 'NEXT_TURN' });
    expect(store().gameLog).toHaveLength(500);
    expect(store().gameLog[0].seq).toBe(11);
  });

  it('init/hydrate/teardown all start a fresh, empty log', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().dispatch({ type: 'NEXT_TURN' });
    expect(store().gameLog.length).toBeGreaterThan(0);

    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    expect(store().gameLog).toEqual([]);

    store().dispatch({ type: 'NEXT_TURN' });
    store().teardown();
    expect(store().gameLog).toEqual([]);
  });

  it('backfills commanderTax when restoring a pre-E139 snapshot that lacks it', () => {
    // Simulates real localStorage bytes written before commander tax existed
    // — `as` bypasses the (now-required) field the same way JSON.parse'd data
    // would, since it carries no static type of its own.
    const legacyState = {
      zones: { library: [], hand: [], graveyard: [], exile: [], command: [] },
      battlefield: [],
      rngSeed: 5,
      turn: 1,
    } as unknown as Omit<PlaytestState, 'past'>;

    store().hydrate('deck-legacy', {
      fingerprint: '1:1',
      savedAt: 0,
      phase: 'playing',
      mulliganCount: 0,
      resistanceLevel: 'off',
      resistanceState: null,
      state: legacyState,
      gameLog: [],
    });

    expect(store().state?.commanderTax).toEqual({});
    // The rest of the legacy state still comes through untouched.
    expect(store().state?.turn).toBe(1);
  });

  it('backfills life/opponents (E138) when resuming a pre-E138 (and pre-E140) snapshot', () => {
    useDecksStore.setState({ decks: [makeDeck({ id: 'deck-10', format: 'paupercommander' })] });
    store().hydrate('deck-10', {
      fingerprint: '1:1',
      savedAt: 0,
      phase: 'playing',
      mulliganCount: 0,
      resistanceLevel: 'off',
      resistanceState: null,
      // Simulates a real pre-E138/E140 localStorage blob: no life fields,
      // no gameLog at all.
      state: {
        zones: { library: [], hand: [], graveyard: [], exile: [], command: [] },
        battlefield: [],
        rngSeed: 5,
        turn: 4,
      } as unknown as Omit<import('@/lib/playtest').PlaytestState, 'past'>,
      gameLog: [],
    });

    // Format-aware defaults, not the generic 20-life fallback — the deck's
    // format was consulted during migration.
    expect(store().state?.life).toBe(30);
    expect(store().state?.opponents).toEqual([
      { life: 30, commanderDamage: 0 },
      { life: 30, commanderDamage: 0 },
      { life: 30, commanderDamage: 0 },
    ]);
    expect(store().state?.commanderDamageThreshold).toBe(16);
    expect(store().state?.tableDefeatedTurn).toBeNull();
    // commanderTax (E139) also backfills on this same legacy path.
    expect(store().state?.commanderTax).toEqual({});
    expect(store().gameLog).toEqual([]);
  });
});

describe('device-local session persistence (E137)', () => {
  beforeEach(() => {
    flushPendingPlaytestSnapshot(); // drain anything a prior test left pending
    localStorage.clear();
    useDecksStore.setState({ decks: [makeDeck()], hydrated: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces the localStorage write after a dispatch, stamped with the deck fingerprint', () => {
    store().init('deck-1', { library: threatLibrary() });
    store().dispatch({ type: 'NEXT_TURN' });

    // Not written yet — still inside the debounce window.
    expect(loadPlaytestSnapshot('deck-1', '100:0')).toBeNull();

    vi.advanceTimersByTime(500);

    const snap = loadPlaytestSnapshot('deck-1', '100:0');
    expect(snap).not.toBeNull();
    expect(snap?.state.turn).toBe(2);
    expect(snap?.phase).toBe('opening');
  });

  it('coalesces a burst of dispatches into a single write of the latest state', () => {
    store().init('deck-1', { library: threatLibrary() });
    store().dispatch({ type: 'NEXT_TURN' });
    vi.advanceTimersByTime(100);
    store().dispatch({ type: 'NEXT_TURN' });
    vi.advanceTimersByTime(100);
    store().dispatch({ type: 'NEXT_TURN' });

    expect(loadPlaytestSnapshot('deck-1', '100:0')).toBeNull();
    vi.advanceTimersByTime(500);
    expect(loadPlaytestSnapshot('deck-1', '100:0')?.state.turn).toBe(4);
  });

  it('flushPendingPlaytestSnapshot writes immediately, e.g. on pagehide/unmount', () => {
    store().init('deck-1', { library: threatLibrary() });
    store().dispatch({ type: 'NEXT_TURN' });

    flushPendingPlaytestSnapshot();

    expect(loadPlaytestSnapshot('deck-1', '100:0')).not.toBeNull();
  });

  it('does not persist the undo stack (state.past) in the saved snapshot', () => {
    store().init('deck-1', { library: threatLibrary() });
    store().dispatch({ type: 'NEXT_TURN' });
    flushPendingPlaytestSnapshot();

    const snap = loadPlaytestSnapshot('deck-1', '100:0');
    expect(snap?.state).not.toHaveProperty('past');
  });

  it('persists the game log alongside the rest of the snapshot', () => {
    store().init('deck-1', { library: threatLibrary() });
    store().dispatch({ type: 'NEXT_TURN' });
    flushPendingPlaytestSnapshot();

    const snap = loadPlaytestSnapshot('deck-1', '100:0');
    expect(snap?.gameLog).toEqual([{ seq: 1, turn: 2, kind: 'turn', text: 'Turn 2 begins' }]);
  });

  it('persists the resistance level alongside the rest of the snapshot', () => {
    store().init('deck-1', { library: threatLibrary() });
    store().setResistanceLevel('ruthless');
    store().dispatch({ type: 'NEXT_TURN' });
    flushPendingPlaytestSnapshot();

    const snap = loadPlaytestSnapshot('deck-1', '100:0');
    expect(snap?.resistanceLevel).toBe('ruthless');
  });

  it('teardown leaves a previously-written snapshot in place', () => {
    store().init('deck-1', { library: threatLibrary() });
    store().dispatch({ type: 'NEXT_TURN' });
    flushPendingPlaytestSnapshot();

    store().teardown();

    expect(loadPlaytestSnapshot('deck-1', '100:0')).not.toBeNull();
  });
});

describe('E141 — session record capture', () => {
  beforeEach(() => {
    localStorage.clear();
    useDecksStore.setState({ decks: [makeDeck()], hydrated: true });
  });

  /** Advances to turn 2 (so the session counts as meaningfully-played) then
   *  wipes the lone opponent's life to trigger a table defeat that turn. */
  function defeatOpponent() {
    store().dispatch({ type: 'NEXT_TURN' });
    store().dispatch({ type: 'ADJUST_LIFE', player: 0, delta: -100 });
  }

  it('records a session on RESET once the game was meaningfully played', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 1 });
    store().dispatch({ type: 'NEXT_TURN' });
    store().dispatch({ type: 'RESET' });

    expect(store().lastSessionRecord).not.toBeNull();
    expect(loadSessionHistory('deck-1')).toHaveLength(1);
  });

  it('does not record on RESET when nothing happened (turn 1, empty board)', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 1 });
    store().dispatch({ type: 'RESET' });

    expect(store().lastSessionRecord).toBeNull();
    expect(loadSessionHistory('deck-1')).toEqual([]);
  });

  it('auto-captures a session the moment the table is defeated, with the kill turn', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 1 });
    defeatOpponent();

    expect(store().lastSessionRecord?.killTurn).toBe(2);
    expect(loadSessionHistory('deck-1')).toHaveLength(1);
  });

  it('does not double-record when RESET follows an already-captured table defeat', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 1 });
    defeatOpponent();
    store().dispatch({ type: 'RESET' });

    expect(loadSessionHistory('deck-1')).toHaveLength(1);
  });

  it('captures the abandoned session when init() replaces a live, meaningfully-played game', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 1 });
    store().dispatch({ type: 'NEXT_TURN' });

    store().init('deck-1', { library: threatLibrary(3), seed: 2 });

    expect(loadSessionHistory('deck-1')).toHaveLength(1);
    expect(store().lastSessionRecord).not.toBeNull();
    // The new session starts with a clean slate.
    expect(store().gameLog).toEqual([]);
  });

  it('does not record on init() when the replaced game was never meaningfully played', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 1 });
    store().init('deck-1', { library: threatLibrary(3), seed: 2 });

    expect(loadSessionHistory('deck-1')).toEqual([]);
  });

  it('captures a meaningfully-played, not-yet-recorded session on teardown', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 1 });
    store().dispatch({ type: 'NEXT_TURN' });
    store().teardown();

    expect(loadSessionHistory('deck-1')).toHaveLength(1);
  });

  it('does not double-record on teardown after an already-captured table defeat', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 1 });
    defeatOpponent();
    store().teardown();

    expect(loadSessionHistory('deck-1')).toHaveLength(1);
  });

  it('exposes lastSessionAggregates alongside the record, reflecting the updated history', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 1 });
    defeatOpponent();

    expect(store().lastSessionAggregates?.sessionsPlayed).toBe(1);
    expect(store().lastSessionAggregates?.bestKillTurn).toBe(2);
  });
});
