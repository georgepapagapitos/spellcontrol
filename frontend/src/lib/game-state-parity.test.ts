/**
 * Cross-module parity guard for the isomorphic game reducer.
 *
 * `backend/src/games/state.ts` and `frontend/src/lib/game-state.ts` are
 * physically duplicated and hand-kept in lockstep (see CLAUDE.md "Drift
 * hazard"). The two existing unit-test files are *also* hand-mirrored, so
 * they can drift together and hide a divergence.
 *
 * This test imports BOTH modules and runs the same scripted action
 * sequences through each `applyAction`, asserting the results are equal.
 * Online play uses the backend copy; local/optimistic play uses the
 * frontend copy — if they ever disagree, the same game diverges between
 * a host and a guest. That is what this catches.
 *
 * The two copies are asserted to produce *fully equal* state. The only
 * normalized-away difference is `events[].id` (generated via
 * crypto.randomUUID(), non-deterministic by design and never semantically
 * compared).
 *
 * `ALLOWED_FRONTEND_ONLY_KEYS` is the escape hatch for a deliberate
 * frontend-only field the server persists opaquely (JSONB) and never
 * branches on. It is currently **empty** — `tapOrientation` used to live
 * here but has been mirrored into the backend copy, restoring full
 * lockstep. Adding a key here must be a conscious, reviewed decision; an
 * empty list is the strongest form of this guard.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as frontend from './game-state';
// Relative import reaches the sibling backend package on purpose: it is the
// non-shared copy this test exists to compare against. It is outside
// `src/lib/**` so it does not enter the frontend coverage scope.
import * as backend from '../../../backend/src/games/state';

type AnyRecord = Record<string, unknown>;
type Reducer = (s: AnyRecord, a: AnyRecord) => AnyRecord;

const ALLOWED_FRONTEND_ONLY_KEYS: readonly string[] = [];

/** Strip non-deterministic ids and any documented presentational-only keys. */
function normalize(state: AnyRecord): AnyRecord {
  const clone = structuredClone(state);
  for (const key of ALLOWED_FRONTEND_ONLY_KEYS) {
    delete clone[key];
  }
  const events = clone.events as AnyRecord[] | undefined;
  if (Array.isArray(events)) {
    clone.events = events.map((ev, i) => ({ ...ev, id: `evt#${i}` }));
  }
  return clone;
}

interface Scenario {
  name: string;
  config: {
    startingLife: number;
    commanderDamageEnabled: boolean;
    poisonEnabled: boolean;
    players: number;
  };
  actions: AnyRecord[];
}

const TS = 1_700_000_000_000;

/** Build an identical lobby from each module's own factories. */
function makeLobby(mod: typeof frontend | typeof backend, c: Scenario['config']): AnyRecord {
  return mod.createGameState({
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u0',
    format: 'commander',
    startingLife: c.startingLife,
    commanderDamageEnabled: c.commanderDamageEnabled,
    poisonEnabled: c.poisonEnabled,
    players: Array.from({ length: c.players }, (_, i) =>
      mod.makePlayer({
        id: `u${i}`,
        userId: `u${i}`,
        seat: i,
        name: `P${i}`,
        startingLife: c.startingLife,
        isHost: i === 0,
      })
    ),
    ts: TS,
  }) as unknown as AnyRecord;
}

const scenarios: Scenario[] = [
  {
    name: 'full lifecycle: start, life swings, set-life, poison, note, end',
    config: { startingLife: 40, commanderDamageEnabled: true, poisonEnabled: true, players: 3 },
    actions: [
      { type: 'start', ts: TS + 1 },
      { type: 'life', seat: 1, delta: -5, actorSeat: 0, ts: TS + 2 },
      { type: 'life', seat: 1, delta: 3, actorSeat: 1, ts: TS + 3 },
      { type: 'set-life', seat: 2, value: 12, actorSeat: null, ts: TS + 4 },
      { type: 'poison', seat: 2, delta: 4, actorSeat: 0, ts: TS + 5 },
      { type: 'poison', seat: 2, delta: -1, actorSeat: 2, ts: TS + 6 },
      { type: 'note', actorSeat: 0, message: 'turn 1 done', ts: TS + 7 },
      { type: 'end', winnerSeat: 0, ts: TS + 8 },
      { type: 'end', winnerSeat: 1, ts: TS + 9 }, // no-op once finished
    ],
  },
  {
    name: 'commander damage reduces life and auto-eliminates at 21',
    config: { startingLife: 40, commanderDamageEnabled: true, poisonEnabled: false, players: 2 },
    actions: [
      { type: 'start', ts: TS + 1 },
      { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 10, actorSeat: 0, ts: TS + 2 },
      { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 11, actorSeat: 0, ts: TS + 3 },
    ],
  },
  {
    name: 'poison loss triggers auto-win for the survivor',
    config: { startingLife: 20, commanderDamageEnabled: false, poisonEnabled: true, players: 2 },
    actions: [
      { type: 'start', ts: TS + 1 },
      { type: 'poison', seat: 1, delta: 10, actorSeat: 0, ts: TS + 2 },
    ],
  },
  {
    name: 'life to zero auto-eliminates; manual revive is additive',
    config: { startingLife: 20, commanderDamageEnabled: false, poisonEnabled: false, players: 3 },
    actions: [
      { type: 'start', ts: TS + 1 },
      { type: 'set-life', seat: 2, value: 0, actorSeat: null, ts: TS + 2 },
      { type: 'eliminate', seat: 2, eliminated: false, ts: TS + 3 },
      { type: 'eliminate', seat: 1, eliminated: true, ts: TS + 4 },
    ],
  },
  {
    name: 'lobby mutation: add / update / remove player, then settings rebase',
    config: { startingLife: 40, commanderDamageEnabled: true, poisonEnabled: false, players: 2 },
    actions: [
      {
        type: 'update-player',
        seat: 1,
        patch: { name: 'Renamed', commander: 'Atraxa' },
        ts: TS + 1,
      },
      { type: 'remove-player', seat: 1, ts: TS + 2 },
      {
        type: 'settings',
        patch: { startingLife: 30, format: 'modern', layout: 'line' },
        ts: TS + 3,
      },
      { type: 'settings', patch: { commanderDamageEnabled: false }, ts: TS + 4 },
    ],
  },
  {
    // Regression guard: tapOrientation used to be a frontend-only field.
    // Both copies must now handle it identically through `settings`.
    name: 'settings carries tapOrientation through both copies',
    config: { startingLife: 40, commanderDamageEnabled: true, poisonEnabled: false, players: 2 },
    actions: [
      { type: 'settings', patch: { tapOrientation: 'vertical' }, ts: TS + 1 },
      { type: 'start', ts: TS + 2 },
      { type: 'settings', patch: { tapOrientation: 'horizontal', layout: 'line' }, ts: TS + 3 },
    ],
  },
  {
    name: 'reset clears progress back to lobby',
    config: { startingLife: 40, commanderDamageEnabled: true, poisonEnabled: true, players: 2 },
    actions: [
      { type: 'start', ts: TS + 1 },
      { type: 'life', seat: 0, delta: -10, actorSeat: 1, ts: TS + 2 },
      { type: 'poison', seat: 0, delta: 3, actorSeat: 1, ts: TS + 3 },
      { type: 'reset', ts: TS + 4 },
    ],
  },
  {
    name: 'start is a no-op outside lobby',
    config: { startingLife: 20, commanderDamageEnabled: false, poisonEnabled: false, players: 2 },
    actions: [
      { type: 'start', ts: TS + 1 },
      { type: 'start', ts: TS + 2 },
    ],
  },
];

beforeAll(() => {
  // Freeze the clock so both modules' internal `Date.now()` fallbacks
  // (maybeAutoWin's `endedAt ?? Date.now()`) resolve identically.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

describe('game reducer parity (backend vs frontend copy)', () => {
  it('exposes the same public surface', () => {
    for (const name of ['applyAction', 'createGameState', 'makePlayer', 'gameToRecord']) {
      expect(typeof (frontend as AnyRecord)[name]).toBe('function');
      expect(typeof (backend as AnyRecord)[name]).toBe('function');
    }
  });

  it.each(scenarios)('produces identical state: $name', ({ config, actions }) => {
    const applyB = backend.applyAction as unknown as Reducer;
    const applyF = frontend.applyAction as unknown as Reducer;

    let stateB = makeLobby(backend, config);
    let stateF = makeLobby(frontend, config);

    // Initial states must already agree (modulo normalization).
    expect(normalize(stateF)).toEqual(normalize(stateB));

    for (const action of actions) {
      stateB = applyB(stateB, action);
      stateF = applyF(stateF, action);
      expect(normalize(stateF)).toEqual(normalize(stateB));
    }
  });

  it('throws identically on an invalid seat', () => {
    const applyB = backend.applyAction as unknown as Reducer;
    const applyF = frontend.applyAction as unknown as Reducer;
    const cfg = {
      startingLife: 20,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: 2,
    };
    const action = { type: 'life', seat: 99, delta: -1, actorSeat: 0, ts: TS };

    expect(() => applyB(makeLobby(backend, cfg), action)).toThrow();
    expect(() => applyF(makeLobby(frontend, cfg), action)).toThrow();
  });

  it('gameToRecord agrees for a finished game', () => {
    const cfg = {
      startingLife: 20,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: 2,
    };
    const seq = [
      { type: 'start', ts: TS + 1 },
      { type: 'set-life', seat: 1, value: 0, actorSeat: 0, ts: TS + 2 },
    ];
    let b = makeLobby(backend, cfg);
    let f = makeLobby(frontend, cfg);
    for (const a of seq) {
      b = (backend.applyAction as unknown as Reducer)(b, a);
      f = (frontend.applyAction as unknown as Reducer)(f, a);
    }
    const recB = backend.gameToRecord(b as never, TS + 100);
    const recF = frontend.gameToRecord(f as never, TS + 100);
    expect(recF).toEqual(recB);
  });
});
