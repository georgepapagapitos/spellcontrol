import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createGameState,
  isHordePassTake,
  makePlayer,
  MAX_HORDE_STEPS,
  type GameState,
  type HordeLogEntry,
} from './index';

// E1037: a horde turn with nothing to attack with passes on the confirm, at
// an online table too. The confirming device says so with `pass`; the reducer
// logs the confirm and the `take 0` Skip would have, in one action.

function startedHorde(players = 3): GameState {
  const lobby = createGameState({
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u0',
    format: 'horde',
    startingLife: 40,
    commanderDamageEnabled: false,
    poisonEnabled: false,
    players: Array.from({ length: players }, (_, i) =>
      makePlayer({
        id: `u${i}`,
        userId: `u${i}`,
        seat: i,
        name: `P${i}`,
        startingLife: 40,
        isHost: i === 0,
      })
    ),
    ts: 1000,
  });
  const set = applyAction(lobby, {
    type: 'horde-setup',
    hordeId: 'h1',
    level: 'standard',
    settings: {
      survivors: players,
      life: 50,
      librarySize: 65,
      setupTurns: 0,
      reveal: { kind: 'until-nontoken' },
      bossTicks: [0.5, 1],
      safeZone: 'reduced',
    },
    seed: 42,
    deckRev: 'rev1',
    ts: 1500,
  });
  return applyAction(set, { type: 'start', ts: 2000 });
}

/** The table on its reveal, waiting for a confirm (log: [reveal]). */
function revealing(players = 3): GameState {
  return applyAction(startedHorde(players), {
    type: 'horde-step',
    step: { k: 'reveal' },
    at: 0,
    actorSeat: 0,
    ts: 3000,
  });
}

function passConfirm(s: GameState, seat: number, at = 1): GameState {
  return applyAction(s, {
    type: 'horde-step',
    step: { k: 'confirm', pass: true },
    at,
    actorSeat: seat,
    ts: 4000,
  });
}

describe('a horde confirm with nothing to attack (E1037)', () => {
  it('passes the turn in the same action: confirm + take 0, no combat stop', () => {
    const s = revealing();
    const passed = passConfirm(s, 1);
    expect(passed.horde!.phase).toBe('survivors');
    expect(passed.horde!.survivorTurn).toBe(s.horde!.survivorTurn + 1);
    expect(passed.horde!.done).toEqual([]);
    expect(passed.horde!.steps.slice(1)).toEqual([
      { k: 'confirm', pass: true, seat: 1, ts: 4000 },
      { k: 'take', dealt: 0, seat: 1, ts: 4000 },
    ]);
    expect(passed.players.map((p) => p.life)).toEqual([50, 50, 50]);
    // Nothing attacked, so there is no hit to note.
    expect(passed.events).toEqual(s.events);
  });

  it('lands on the table Skip leaves, apart from the pass marker', () => {
    const s = revealing();
    const passed = passConfirm(s, 0);
    const confirmed = applyAction(s, {
      type: 'horde-step',
      step: { k: 'confirm' },
      at: 1,
      actorSeat: 0,
      ts: 4000,
    });
    const skipped = applyAction(confirmed, {
      type: 'horde-step',
      step: { k: 'take', dealt: 0 },
      at: 2,
      actorSeat: 0,
      ts: 4000,
    });
    const unmark = (steps: HordeLogEntry[]) =>
      steps.map((e) => (e.k === 'confirm' ? { k: e.k, seat: e.seat, ts: e.ts } : e));
    expect({ ...passed.horde!, steps: unmark(passed.horde!.steps) }).toEqual(skipped.horde);
    expect(passed.players).toEqual(skipped.players);
  });

  it('several seats confirming the same reveal at once log it once', () => {
    const s = revealing(4);
    const first = passConfirm(s, 2);
    // Every other seat dispatched against the log they saw (at 1): stale now.
    for (const seat of [0, 1, 3]) {
      expect(passConfirm(first, seat, 1)).toBe(first);
      expect(
        applyAction(first, { type: 'horde-step', step: { k: 'confirm' }, at: 1, actorSeat: seat })
      ).toBe(first);
    }
    expect(first.horde!.steps).toHaveLength(3);
    // A seat's Skip from the combat view it never got also lands nowhere.
    expect(
      applyAction(first, { type: 'horde-step', step: { k: 'take', dealt: 0 }, at: 2, actorSeat: 3 })
    ).toBe(first);
  });

  it('an old client confirm (no pass) still stops on combat, as before', () => {
    const s = applyAction(revealing(), {
      type: 'horde-step',
      step: { k: 'confirm' },
      at: 1,
      actorSeat: 0,
    });
    expect(s.horde!.phase).toBe('combat');
    expect(s.horde!.steps).toHaveLength(2);
  });

  it('is a no-op outside the reveal', () => {
    const s = startedHorde();
    expect(passConfirm(s, 0, 0)).toBe(s);
    // Sent during combat (a plain confirm already landed): no second take.
    const combat = applyAction(revealing(), {
      type: 'horde-step',
      step: { k: 'confirm' },
      at: 1,
      actorSeat: 0,
    });
    expect(passConfirm(combat, 1, 2)).toBe(combat);
  });

  it('a pass marker with a crafted nonzero take undoes like any take, life restored', () => {
    const s = revealing();
    const crafted: GameState = {
      ...s,
      players: s.players.map((p) => ({ ...p, life: 43 })),
      horde: {
        ...s.horde!,
        phase: 'survivors',
        survivorTurn: 2,
        steps: [
          ...s.horde!.steps,
          { k: 'confirm', pass: true, seat: 0, ts: 4000 },
          { k: 'take', dealt: 7, seat: 0, ts: 4000 },
        ],
      },
    };
    const undone = applyAction(crafted, { type: 'horde-undo', at: 3, actorSeat: 0 });
    expect(undone.players.map((p) => p.life)).toEqual([50, 50, 50]);
    expect(undone.horde!.phase).toBe('combat');
    expect(undone.horde!.steps).toHaveLength(2);
  });

  it('undoes as one step, back to the reveal', () => {
    const s = revealing();
    const passed = passConfirm(s, 1);
    const undone = applyAction(passed, { type: 'horde-undo', at: 3, actorSeat: 2 });
    expect(undone.horde).toEqual(s.horde);
    expect(undone.players).toEqual(s.players);
  });

  it('a manual Skip after a plain confirm still undoes to combat', () => {
    let s = applyAction(revealing(), {
      type: 'horde-step',
      step: { k: 'confirm' },
      at: 1,
      actorSeat: 0,
    });
    s = applyAction(s, { type: 'horde-step', step: { k: 'take', dealt: 0 }, at: 2, actorSeat: 0 });
    const undone = applyAction(s, { type: 'horde-undo', at: 3, actorSeat: 0 });
    expect(undone.horde!.phase).toBe('combat');
    expect(undone.horde!.steps).toHaveLength(2);
  });

  it('needs room for both entries in the log', () => {
    let s = revealing();
    const room = MAX_HORDE_STEPS - 1;
    s = {
      ...s,
      horde: { ...s.horde!, steps: Array.from({ length: room }, () => s.horde!.steps[0]) },
    };
    expect(() => passConfirm(s, 0, room)).toThrow(/step limit/);
    // A plain confirm still fits the last slot.
    const plain = applyAction(s, {
      type: 'horde-step',
      step: { k: 'confirm' },
      at: room,
      actorSeat: 0,
    });
    expect(plain.horde!.steps).toHaveLength(MAX_HORDE_STEPS);
  });
});

describe('isHordePassTake', () => {
  const at = (k: HordeLogEntry) => k;
  const reveal = at({ k: 'reveal', seat: 0, ts: 1 });
  const take0 = at({ k: 'take', dealt: 0, seat: 0, ts: 2 });

  it('is the take right after a passing confirm, and nothing else', () => {
    const steps = [reveal, at({ k: 'confirm', pass: true, seat: 0, ts: 2 }), take0];
    expect(isHordePassTake(steps, 2)).toBe(true);
    expect(isHordePassTake(steps, 1)).toBe(false);
    expect(isHordePassTake(steps, 0)).toBe(false);
  });

  it('only a take of 0 counts', () => {
    const steps = [
      reveal,
      at({ k: 'confirm', pass: true, seat: 0, ts: 2 }),
      at({ k: 'take', dealt: 7, seat: 0, ts: 2 }),
    ];
    expect(isHordePassTake(steps, 2)).toBe(false);
  });

  it('a log persisted before E1037 has no pass takes', () => {
    const old = [reveal, at({ k: 'confirm', seat: 0, ts: 2 }), take0];
    expect(old.map((_, i) => isHordePassTake(old, i))).toEqual([false, false, false]);
  });
});
