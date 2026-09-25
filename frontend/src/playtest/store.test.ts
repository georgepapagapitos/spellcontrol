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
import { fingerprintDeck, loadPlaytestSnapshot } from '@/lib/playtest/session-snapshot';
import { loadSessionHistory } from '@/lib/playtest/session-history';
import { ZOMBIE_HORDE_FIXTURE } from '@/lib/horde/deck.fixtures';
import { buildHordeLibrary, resolveHordeSettings, type HordeSettings } from '@/lib/horde';

const STANDARD = RESISTANCE_PRESETS.standard;

// The decks-store sync subscriber (E133) fire-and-forgets a dynamic
// `import('../lib/sync')` on every `decks` change; mock it the same way
// `store/decks.test.ts` does so seeding a deck here can't touch the network.
vi.mock('@/lib/sync', () => ({
  persistDecksState: vi.fn().mockResolvedValue(undefined),
}));

// The horde suite drives a tiny, fully-controlled fixture deck instead of one
// of the six shipped ones — `loadHordeDeck('zombies')` swaps to it so every
// other engine function (settings, library building, turn planning) still
// runs for real. `id !== 'zombies'` falls through to the real loader, which
// is what the bad-load test below exercises.
vi.mock('@/lib/horde', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/horde')>();
  return {
    ...actual,
    loadHordeDeck: vi.fn((id: string) =>
      id === 'zombies' ? Promise.resolve(ZOMBIE_HORDE_FIXTURE) : actual.loadHordeDeck(id)
    ),
  };
});

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
  store().setFreeMulligan(false);
});

// A dispatch anywhere below can schedule the module-level snapshot debounce
// (store.ts's `usePlaytestStore.subscribe`); teardown() only skips scheduling
// a NEW one, it doesn't clear an existing one. Whichever test runs last in
// the file would otherwise leave that real setTimeout pending past the run.
afterEach(() => {
  flushPendingPlaytestSnapshot();
});

describe('playtest store — free mulligan variant (E226)', () => {
  function mulliganOnce() {
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    store().mulliganOpeningHand();
  }

  it('keeps the London bottom-N step by default', () => {
    mulliganOnce();
    store().keepOpeningHand();
    expect(store().phase).toBe('mulligan-bottom');
  });

  it('skips the bottom-N step when free mulligans are on', () => {
    store().setFreeMulligan(true);
    mulliganOnce();
    store().keepOpeningHand();
    expect(store().phase).toBe('playing');
  });

  it('still redraws a full seven', () => {
    store().setFreeMulligan(true);
    mulliganOnce();
    store().mulliganOpeningHand();
    expect(store().mulliganCount).toBe(2);
    expect(store().state!.zones.hand).toHaveLength(7);
  });

  it('journals each card put on the bottom by the London step', () => {
    mulliganOnce();
    store().keepOpeningHand();
    expect(store().phase).toBe('mulligan-bottom');
    const [first] = store().state!.zones.hand;
    store().finalizeBottom([first.id]);
    expect(store().phase).toBe('playing');
    expect(store().state!.zones.library.at(-1)!.id).toBe(first.id);
    const last = store().gameLog.at(-1)!;
    expect(last.kind).toBe('zone-move');
    expect(last.text).toBe(`${first.name}: hand → bottom of library`);
    expect(last.cardName).toBe(first.name);
    // The rewind trail names the step the same way.
    expect(store().rewindTrail[0]?.summary).toBe(`${first.name}: hand → bottom of library`);
  });

  it('releases a hand already stranded on the bottom-N step', () => {
    mulliganOnce();
    store().keepOpeningHand();
    expect(store().phase).toBe('mulligan-bottom');
    store().setFreeMulligan(true);
    expect(store().phase).toBe('playing');
  });

  it('is a device preference — a new session keeps it armed', () => {
    store().setFreeMulligan(true);
    store().init('deck-1', { library: threatLibrary(), seed: 42 });
    expect(store().freeMulligan).toBe(true);
    expect(localStorage.getItem('spellcontrol:playtest:freeMulligan')).toBe('1');
  });
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
        zones: { library: [], hand: [], graveyard: [], exile: [], sideboard: [], command: [] },
        battlefield: [],
        rngSeed: 5,
        turn: 4,
        commanderTax: {},
        life: 40,
        startingLife: 40,
        monarch: false,
        initiative: false,
        citysBlessing: false,
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
    expect(store().gameLog).toMatchObject([
      { seq: 1, turn: 2, kind: 'turn', text: 'Turn 2 begins', verdict: 'consent' },
    ]);
  });

  it('records a designation change dispatched through the store', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().dispatch({ type: 'SET_DESIGNATION', designation: 'monarch', held: true });
    expect(store().gameLog).toMatchObject([
      { seq: 1, turn: 1, kind: 'designation', text: 'Took the Monarch', verdict: 'consent' },
    ]);
    expect(store().state?.monarch).toBe(true);
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

  it('a resolved scry logs what was kept and what went to the bottom', () => {
    store().init('deck-1', { library: threatLibrary(12), seed: 42 });
    const [a, b] = store().state!.zones.library;
    store().dispatch({ type: 'RESOLVE_TOP', mode: 'scry', top: [a.id], bottom: [b.id] });
    expect(store().gameLog).toMatchObject([
      { seq: 1, turn: 1, kind: 'scry', text: 'Scried 2 — 1 to the bottom', verdict: 'locked' },
    ]);
  });

  it('mulliganOpeningHand logs a mulligan entry', () => {
    store().init('deck-1', { library: threatLibrary(3), seed: 42 });
    store().mulliganOpeningHand();
    expect(store().gameLog).toMatchObject([
      {
        seq: 1,
        turn: 1,
        kind: 'mulligan',
        text: `Mulliganed to ${store().state!.zones.hand.length}`,
        verdict: 'locked',
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
    // Designations postdate this shape too — same backfill treatment.
    expect(store().state?.monarch).toBe(false);
    expect(store().state?.initiative).toBe(false);
    expect(store().state?.citysBlessing).toBe(false);
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
    expect(store().state?.startingLife).toBe(30);
    // commanderTax (E139) also backfills on this same legacy path.
    expect(store().state?.commanderTax).toEqual({});
    // ...and so do designations, which postdate even commanderTax.
    expect(store().state?.monarch).toBe(false);
    expect(store().state?.initiative).toBe(false);
    expect(store().state?.citysBlessing).toBe(false);
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
    expect(snap?.gameLog).toMatchObject([
      { seq: 1, turn: 2, kind: 'turn', text: 'Turn 2 begins', verdict: 'consent' },
    ]);
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
});

// The P/T box reads `PlaytestCard.power`, which `deckToPlaytestInit` copies off
// the deck's own stored card — and a deck built before the card cache kept
// `power`/`toughness` (#2004) holds creatures with no body at all. Verified on
// the live public board after the cache was re-ingested: 7 permanents, 0
// badges. `applyPrintedBodies` is the repair; these guard its edges.
//
// If these fail: the patch is missing a zone, rewriting a body it shouldn't
// own, or leaking into the undo stack (it is data repair, not a move).
describe('playtest store — printed-body backfill', () => {
  const BODIES = new Map([
    ['Goblin Trashmaster', { power: '3', toughness: '3' }],
    ['Tarmogoyf', { power: '*', toughness: '1+*' }],
  ]);

  function bodilessLibrary(): PlaytestCard[] {
    return [
      { id: 'c-1', name: 'Goblin Trashmaster', typeLine: 'Creature — Goblin' },
      { id: 'c-2', name: 'Goblin Trashmaster', typeLine: 'Creature — Goblin' },
      { id: 'c-3', name: 'Tarmogoyf', typeLine: 'Creature — Lhurgoyf' },
      { id: 'c-4', name: 'Mountain', typeLine: 'Basic Land — Mountain' },
    ];
  }

  function cardById(id: string): PlaytestCard | undefined {
    const s = store().state as PlaytestState;
    return [...s.zones.library, ...s.zones.hand, ...s.battlefield.map((b) => b.card)].find(
      (c) => c.id === id
    );
  }

  beforeEach(() => {
    store().init('deck-1', { library: bodilessLibrary(), seed: 7 });
  });

  it('fills in the printed body of every copy, wherever it sits', () => {
    store().applyPrintedBodies(BODIES);
    expect(cardById('c-1')).toMatchObject({ power: '3', toughness: '3' });
    expect(cardById('c-2')).toMatchObject({ power: '3', toughness: '3' });
  });

  it('keeps a non-numeric body verbatim', () => {
    store().applyPrintedBodies(BODIES);
    expect(cardById('c-3')).toMatchObject({ power: '*', toughness: '1+*' });
  });

  it('leaves a card with no body among the answers untouched', () => {
    store().applyPrintedBodies(BODIES);
    expect(cardById('c-4')?.power).toBeUndefined();
  });

  it('reaches a permanent already on the battlefield', () => {
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: 'c-1', x: 0.5, y: 0.5 });
    store().applyPrintedBodies(BODIES);
    const bf = (store().state as PlaytestState).battlefield.find((b) => b.card.id === 'c-1');
    expect(bf?.card).toMatchObject({ power: '3', toughness: '3' });
  });

  it('patches history too, so an undo does not take the badges back off', () => {
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: 'c-1', x: 0.5, y: 0.5 });
    store().applyPrintedBodies(BODIES);
    store().dispatch({ type: 'UNDO' });
    expect(cardById('c-1')).toMatchObject({ power: '3', toughness: '3' });
  });

  it('writes no undo entry of its own — it is data repair, not a move', () => {
    const before = (store().state as PlaytestState).past.length;
    store().applyPrintedBodies(BODIES);
    expect((store().state as PlaytestState).past).toHaveLength(before);
  });

  it('never overwrites a body the card already prints', () => {
    store().init('deck-1', {
      library: [{ id: 'c-9', name: 'Goblin Trashmaster', power: '2', toughness: '2' }],
      seed: 7,
    });
    store().applyPrintedBodies(BODIES);
    expect(cardById('c-9')).toMatchObject({ power: '2', toughness: '2' });
  });

  it('never overwrites a hand-made token, whose body is whatever its maker typed', () => {
    store().dispatch({
      type: 'CREATE_TOKEN',
      card: { id: 'tok-1', name: 'Goblin Trashmaster', isToken: true },
      x: 0.5,
      y: 0.5,
    });
    store().applyPrintedBodies(BODIES);
    const tok = (store().state as PlaytestState).battlefield.find((b) => b.card.id === 'tok-1');
    expect(tok?.card.power).toBeUndefined();
  });

  it('leaves the state object identical when there is nothing to fix', () => {
    const before = store().state;
    store().applyPrintedBodies(new Map([['Nobody Here', { power: '1', toughness: '1' }]]));
    expect(store().state).toBe(before);
  });

  // The patch once rebuilt `zones` from a hand-kept list that predated the
  // sideboard, so the first backfill erased it and the board crashed reading
  // `zones.sideboard.length` on every load, the undo stack included.
  it('keeps every zone, the sideboard included, in the present and in history', () => {
    store().init('deck-1', {
      library: bodilessLibrary(),
      sideboard: [{ id: 'sb-1', name: 'Goblin Trashmaster', origin: 'sideboard' }],
      seed: 7,
    });
    store().dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: 'c-1', x: 0.5, y: 0.5 });
    store().applyPrintedBodies(BODIES);
    const s = store().state as PlaytestState;
    expect(Object.keys(s.zones).sort()).toEqual(
      ['command', 'exile', 'graveyard', 'hand', 'library', 'sideboard'].sort()
    );
    expect(s.zones.sideboard).toEqual([
      expect.objectContaining({ id: 'sb-1', power: '3', toughness: '3' }),
    ]);
    for (const entry of s.past) expect(entry.zones.sideboard).toHaveLength(1);
  });
});

describe('playtest store — solo horde (E387 PR 5)', () => {
  // `until-nontoken` (the standard preset) stops a wave at the first
  // nontoken card, which makes the exact reveal depend on shuffle order.
  // `fixed` with count === librarySize reveals the WHOLE (tiny) library in
  // one wave regardless of order, so every assertion below can rely on
  // exact counts without needing to predict a shuffle. The fixture's first
  // two tokens plus its first spell are all creatures (2/2 Zombies, a 2/2
  // Geralf's Messenger), so the reveal is always 3 attackers, 6 power.
  const FIXED_REVEAL: Partial<HordeSettings> = {
    librarySize: 3,
    safeZone: 'off',
    setupTurns: 0,
    bossTicks: [],
    reveal: { kind: 'fixed', count: 3 },
  };

  function initPlayer() {
    store().init('deck-1', { library: threatLibrary(), seed: 1 });
  }

  it('arms the horde: sets life as one undoable entry, and undo disarms', async () => {
    initPlayer();
    expect(store().state!.life).toBe(20);

    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    expect(store().horde).not.toBeNull();
    expect(store().horde!.config.hordeName).toBe('The Undying Horde');
    expect(store().horde!.phase).toBe('waiting');
    // Standard, 1 survivor.
    expect(store().state!.life).toBe(40);
    expect(store().state!.past).toHaveLength(1);
    expect(store().hordePast).toEqual([null]);

    store().dispatch({ type: 'UNDO' });
    expect(store().horde).toBeNull();
    expect(store().state!.life).toBe(20);
    expect(store().hordePast).toEqual([]);
  });

  it('still pushes one entry when the preset life equals the current life', async () => {
    initPlayer();
    usePlaytestStore.setState({ state: { ...store().state!, life: 40 } });

    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    expect(store().state!.life).toBe(40);
    expect(store().state!.past).toHaveLength(1); // forced push, not a no-op

    store().dispatch({ type: 'UNDO' });
    expect(store().horde).toBeNull();
  });

  it('a bad horde id sets a retryable error and leaves no horde armed', async () => {
    initPlayer();
    await store().armHorde('not-a-real-horde', 'standard');
    expect(store().horde).toBeNull();
    expect(store().hordeLoad.status).toBe('error');
    expect(store().hordeLoad.error).toMatch(/Unknown horde deck/);

    store().retryHordeLoad();
    await vi.waitFor(() => expect(store().hordeLoad.status).toBe('error'));
    expect(store().hordeLoad.pending).toEqual({
      hordeId: 'not-a-real-horde',
      level: 'standard',
      overrides: {},
    });
  });

  it('startHordeTurn is a no-op until the setup turns pass', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', { ...FIXED_REVEAL, setupTurns: 3 });
    const before = store().horde;
    const pastBefore = store().state!.past.length;

    store().startHordeTurn();
    expect(store().horde).toBe(before);
    expect(store().state!.past).toHaveLength(pastBefore);
  });

  it('runs a full horde turn — reveal, confirm, combat, resolve — one entry each', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);

    store().startHordeTurn();
    expect(store().horde!.phase).toBe('reveal');
    expect(store().horde!.pendingReveal!.revealed).toHaveLength(3);
    expect(store().state!.past).toHaveLength(2);
    expect(store().gameLog.at(-1)?.text).toBe('The horde reveals 3 cards');

    store().confirmHordeReveal();
    expect(store().horde!.phase).toBe('combat');
    expect(store().horde!.attackingIds).toHaveLength(3);
    expect(store().horde!.pendingAttack).toMatchObject({ attackers: 3, power: 6 });
    expect(store().state!.past).toHaveLength(3);

    const turnBefore = store().state!.turn;
    store().resolveHordeAttack(10);
    expect(store().state!.life).toBe(30);
    expect(store().state!.turn).toBe(turnBefore + 1);
    expect(store().horde!.phase).toBe('waiting');
    expect(store().horde!.damageTaken).toBe(10);
    expect(store().horde!.attackingIds).toHaveLength(0);
    // ONE entry for the whole "resolve damage + pass the turn" step.
    expect(store().state!.past).toHaveLength(4);
    expect(store().gameLog.some((e) => e.text.includes('You took 10'))).toBe(true);
    expect(store().gameLog.at(-1)?.text).toBe(`Turn ${turnBefore + 1} begins`);
  });

  it('resolving with 0 damage is legal and still passes the turn', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    store().startHordeTurn();
    store().confirmHordeReveal();
    const pastBefore = store().state!.past.length;

    store().resolveHordeAttack(0);
    expect(store().state!.life).toBe(40);
    expect(store().state!.past).toHaveLength(pastBefore + 1);
    expect(store().horde!.phase).toBe('waiting');
  });

  it('undo after resolve returns to combat with the same attackers', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    store().startHordeTurn();
    store().confirmHordeReveal();
    const attackersBefore = store().horde!.attackingIds;
    const pendingAttackBefore = store().horde!.pendingAttack;
    store().resolveHordeAttack(10);

    store().dispatch({ type: 'UNDO' });
    expect(store().state!.life).toBe(40);
    expect(store().state!.turn).toBe(1);
    expect(store().horde!.phase).toBe('combat');
    expect(store().horde!.attackingIds).toEqual(attackersBefore);
    expect(store().horde!.pendingAttack).toEqual(pendingAttackBefore);
  });

  it('undo after confirm returns to the reveal', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    store().startHordeTurn();
    const revealBefore = store().horde!.pendingReveal;
    store().confirmHordeReveal();

    store().dispatch({ type: 'UNDO' });
    expect(store().horde!.phase).toBe('reveal');
    expect(store().horde!.pendingReveal).toEqual(revealBefore);
  });

  it('your own action between horde steps keeps hordePast aligned through two undos', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    const handBefore = store().state!.zones.hand.length;

    store().dispatch({ type: 'DRAW', n: 1 });
    expect(store().horde!.phase).toBe('waiting'); // untouched by an ordinary draw

    store().startHordeTurn();
    expect(store().horde!.phase).toBe('reveal');

    store().dispatch({ type: 'UNDO' }); // undoes startHordeTurn
    expect(store().horde!.phase).toBe('waiting');
    expect(store().state!.zones.hand).toHaveLength(handBefore + 1);

    store().dispatch({ type: 'UNDO' }); // undoes the draw
    expect(store().horde!.phase).toBe('waiting');
    expect(store().state!.zones.hand).toHaveLength(handBefore);

    store().dispatch({ type: 'UNDO' }); // undoes the arm
    expect(store().horde).toBeNull();
  });

  it('damageHorde mills the library and crosses a boss tick', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', {
      librarySize: 4,
      safeZone: 'off',
      setupTurns: 0,
      bossTicks: [0.5],
    });
    expect(store().horde!.board.zones.library).toHaveLength(4);

    store().damageHorde(2);
    const horde = store().horde!;
    expect(horde.board.zones.library).toHaveLength(2);
    expect(horde.cardsMilledByDamage).toBe(2);
    expect(horde.bossTicksCrossed).toEqual([0]);
    expect(horde.lastDamageResult).toMatchObject({ amount: 2, before: 4, after: 2 });
    expect(horde.lastDamageResult!.bossesEntered).toEqual([{ name: 'Gisa and Geralf', tick: 0.5 }]);
    expect(horde.board.battlefield.some((b) => b.card.name === 'Gisa and Geralf')).toBe(true);
    expect(store().gameLog.some((e) => e.text === 'Gisa and Geralf joins the horde')).toBe(true);
    expect(store().gameLog.some((e) => e.text === 'The horde took 2 damage. Milled 2')).toBe(true);

    store().clearHordeDamageResult();
    expect(store().horde!.lastDamageResult).toBeNull();
  });

  it('deals a boss on confirm when the reveal alone crosses the tick, not just damage (E436)', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', {
      librarySize: 10,
      safeZone: 'off',
      setupTurns: 0,
      bossTicks: [0.5],
      reveal: { kind: 'fixed', count: 6 },
    });
    expect(store().horde!.board.zones.library).toHaveLength(10);

    store().startHordeTurn();
    expect(store().horde!.pendingReveal!.revealed).toHaveLength(6);

    store().confirmHordeReveal();
    const horde = store().horde!;
    expect(horde.bossTicksCrossed).toEqual([0]);
    const bossOnBoard = horde.board.battlefield.find((b) => b.card.name === 'Gisa and Geralf');
    expect(bossOnBoard).toBeDefined();
    // Inside the same turn's attack, not skipped — and still one undo entry.
    expect(horde.phase).toBe('combat');
    expect(horde.attackingIds).toContain(bossOnBoard!.card.id);
    expect(
      store().gameLog.some(
        (e) => e.text === 'Half the horde is gone. Gisa and Geralf joins the battlefield.'
      )
    ).toBe(true);

    // Damaging further never re-deals the same tick.
    store().damageHorde(1);
    expect(store().horde!.bossTicksCrossed).toEqual([0]);
  });

  it('keeps the library in its dealt order when armed, not a fresh shuffle (E432)', async () => {
    initPlayer();
    const rngSeed = store().state!.rngSeed;
    const settings = resolveHordeSettings('standard', 1, FIXED_REVEAL);
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    const { library } = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, settings, rngSeed);
    expect(store().horde!.board.zones.library.map((c) => c.id)).toEqual(library.map((c) => c.id));
  });

  it('moveHordeCard drops the card and, in combat, recomputes the attack', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    store().startHordeTurn();
    store().confirmHordeReveal();
    const [firstId] = store().horde!.attackingIds;
    const firstName = store().horde!.board.battlefield.find((b) => b.card.id === firstId)!.card
      .name;

    store().moveHordeCard(firstId, 'graveyard');
    expect(store().horde!.attackingIds).not.toContain(firstId);
    expect(store().horde!.pendingAttack!.attackers).toBe(2);
    expect(store().gameLog.at(-1)?.text).toBe(`${firstName} destroyed`);
  });

  it('wins once the last creature is destroyed with the library already empty', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    store().startHordeTurn();
    store().confirmHordeReveal();
    expect(store().horde!.board.zones.library).toHaveLength(0);

    for (const id of [...store().horde!.attackingIds]) {
      store().moveHordeCard(id, 'graveyard');
    }
    expect(store().horde!.outcome).toBe('won');
    expect(store().horde!.phase).toBe('ended');
  });

  it('loses when an ordinary life change drops you to zero', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    store().dispatch({ type: 'ADJUST_LIFE', delta: -40 });
    expect(store().horde!.outcome).toBe('lost');
    expect(store().horde!.phase).toBe('ended');
  });

  it('Reset re-arms the same horde fresh', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    store().startHordeTurn();
    store().confirmHordeReveal();
    store().resolveHordeAttack(10);
    expect(store().state!.life).toBe(30);

    store().dispatch({ type: 'RESET' });
    await vi.waitFor(() => expect(store().horde).not.toBeNull());
    expect(store().state!.life).toBe(40); // fresh game, fresh arm
    expect(store().horde!.phase).toBe('waiting');
    expect(store().horde!.config.hordeId).toBe('zombies');
    expect(store().horde!.config.level).toBe('standard');
  });

  it('arming Resistance disarms an active horde as one undoable entry', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    const pastBefore = store().state!.past.length;

    store().setResistanceLevel('standard');
    expect(store().horde).toBeNull();
    expect(store().resistanceLevel).toBe('standard');
    expect(store().state!.past).toHaveLength(pastBefore + 1);

    store().dispatch({ type: 'UNDO' });
    expect(store().horde).not.toBeNull();
  });

  it('arming a horde while Resistance is on turns Resistance off', async () => {
    initPlayer();
    store().setResistanceLevel('standard');
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    expect(store().resistanceLevel).toBe('off');
    expect(store().resistanceState).toBeNull();
    expect(store().horde).not.toBeNull();
  });

  it('a saved snapshot with an armed horde resumes it', async () => {
    const deck = makeDeck({ id: 'deck-1' });
    useDecksStore.setState({ decks: [deck] });
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    store().startHordeTurn();
    const armedHorde = store().horde;

    flushPendingPlaytestSnapshot();
    const snapshot = loadPlaytestSnapshot('deck-1', fingerprintDeck(deck));
    expect(snapshot?.horde).toEqual(armedHorde);

    store().teardown();
    store().hydrate('deck-1', snapshot!);
    expect(store().horde).toEqual(armedHorde);
    expect(store().hordePast).toEqual([]);
  });

  it('the session record carries the horde on Reset', async () => {
    initPlayer();
    await store().armHorde('zombies', 'standard', FIXED_REVEAL);
    store().startHordeTurn();
    store().confirmHordeReveal();
    store().resolveHordeAttack(5); // also advances the turn, so the session is meaningful

    store().dispatch({ type: 'RESET' });
    expect(store().lastSessionRecord?.horde).toEqual({
      hordeId: 'zombies',
      hordeName: 'The Undying Horde',
      level: 'standard',
      outcome: null,
    });
    // Let the fire-and-forget re-arm settle so it doesn't spill into the next test.
    await vi.waitFor(() => expect(store().horde).not.toBeNull());
  });
});
