import { describe, it, expect, beforeEach } from 'vitest';
import {
  capture,
  canUndo,
  peekLabel,
  popRestore,
  clearUndo,
  isUndoable,
  runSuppressed,
} from './undo-stack';
import { applyAction, createGameState, makePlayer, type GameState } from './game-state';

function game(): GameState {
  return createGameState({
    id: 'g1',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players: [
      makePlayer({ id: 'p0', userId: null, seat: 0, name: 'Alice', startingLife: 40 }),
      makePlayer({ id: 'p1', userId: null, seat: 1, name: 'Bob', startingLife: 40 }),
    ],
  });
}

describe('undo-stack', () => {
  beforeEach(() => clearUndo('g1'));

  it('flags only the undoable action kinds', () => {
    expect(isUndoable({ type: 'life', seat: 0, delta: -1, actorSeat: 0 })).toBe(true);
    expect(isUndoable({ type: 'set-life', seat: 0, value: 5, actorSeat: 0 })).toBe(true);
    expect(isUndoable({ type: 'eliminate', seat: 0, eliminated: true })).toBe(true);
    expect(isUndoable({ type: 'start' })).toBe(false);
    expect(isUndoable({ type: 'note', actorSeat: null, message: 'hi' })).toBe(false);
  });

  it('restores a single life change', () => {
    let g = applyAction(game(), { type: 'start' });
    const before = g;
    const action = { type: 'life', seat: 0, delta: -7, actorSeat: 0 } as const;
    capture('g1', before, action);
    g = applyAction(g, action);
    expect(g.players[0].life).toBe(33);
    expect(canUndo('g1')).toBe(true);
    expect(peekLabel('g1')).toContain('Alice');

    const restore = popRestore('g1', g);
    for (const a of restore) g = applyAction(g, a);
    expect(g.players[0].life).toBe(40);
    expect(canUndo('g1')).toBe(false);
  });

  it('coalesces a rapid burst into one undo', () => {
    let g = applyAction(game(), { type: 'start' });
    for (let i = 0; i < 5; i++) {
      const a = { type: 'life', seat: 0, delta: -1, actorSeat: 0 } as const;
      capture('g1', g, a);
      g = applyAction(g, a);
    }
    expect(g.players[0].life).toBe(35);
    const restore = popRestore('g1', g);
    for (const a of restore) g = applyAction(g, a);
    expect(g.players[0].life).toBe(40);
    expect(canUndo('g1')).toBe(false); // whole burst was one step
  });

  it('reverses a lethal hit including the auto-eliminated flag', () => {
    let g = applyAction(game(), { type: 'start' });
    const action = { type: 'set-life', seat: 1, value: 0, actorSeat: 1 } as const;
    capture('g1', g, action);
    g = applyAction(g, action);
    expect(g.players[1].eliminated).toBe(true);

    const restore = popRestore('g1', g);
    for (const a of restore) g = applyAction(g, a);
    expect(g.players[1].life).toBe(40);
    expect(g.players[1].eliminated).toBe(false);
  });

  it('restores commander damage and its life side-effect', () => {
    let g = applyAction(game(), { type: 'start' });
    const action = { type: 'cmd-dmg', seat: 0, fromSeat: 1, delta: 6, actorSeat: 1 } as const;
    capture('g1', g, action);
    g = applyAction(g, action);
    expect(g.players[0].commanderDamage[1]).toBe(6);
    expect(g.players[0].life).toBe(34);

    const restore = popRestore('g1', g);
    for (const a of restore) g = applyAction(g, a);
    expect(g.players[0].commanderDamage[1] ?? 0).toBe(0);
    expect(g.players[0].life).toBe(40);
  });

  it('does not capture while suppressed', () => {
    const g = applyAction(game(), { type: 'start' });
    runSuppressed(() => capture('g1', g, { type: 'life', seat: 0, delta: -1, actorSeat: 0 }));
    expect(canUndo('g1')).toBe(false);
  });
});
