/**
 * Undo for the life-counter board.
 *
 * The reducer is shared with the server and never gets an "undo" action —
 * instead we snapshot the relevant per-seat fields *before* an undoable
 * action and, on undo, emit ordinary compensating actions (set-life,
 * poison/cmd-dmg deltas, eliminate) that drive the state back. This works
 * identically for local and online games with zero backend coupling, and
 * it correctly reverses auto-eliminations (restoring the eliminated flag
 * and life in one go).
 *
 * Snapshots live in a module-level map keyed by game id so the stack
 * survives panel re-renders. It is intentionally *not* persisted: undo is
 * for immediate misclicks, not session-spanning time travel.
 */

import type { GameAction, GameState } from './game-state';

interface SeatSnapshot {
  seat: number;
  life: number;
  poison: number;
  commanderDamage: Record<number, number>;
  eliminated: boolean;
}

interface Snapshot {
  players: SeatSnapshot[];
  /** Short human label for the action this snapshot can undo. */
  label: string;
  /** Kind + target used to coalesce rapid bursts into one undo step. */
  groupKey: string;
  ts: number;
}

const MAX_DEPTH = 30;
/** Same-seat, same-kind actions within this window collapse into one undo. */
const GROUP_WINDOW_MS = 1500;

const stacks = new Map<string, Snapshot[]>();
let suppressed = false;

/** Actions a misclick is plausibly made of — the only ones we snapshot. */
export function isUndoable(action: GameAction): boolean {
  return (
    action.type === 'life' ||
    action.type === 'set-life' ||
    action.type === 'poison' ||
    action.type === 'cmd-dmg' ||
    action.type === 'eliminate'
  );
}

function snap(game: GameState): SeatSnapshot[] {
  return game.players.map((p) => ({
    seat: p.seat,
    life: p.life,
    poison: p.poison,
    commanderDamage: { ...p.commanderDamage },
    eliminated: p.eliminated,
  }));
}

function labelFor(action: GameAction, game: GameState): { label: string; groupKey: string } {
  const seat = 'seat' in action ? action.seat : null;
  const name =
    seat != null ? (game.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`) : '';
  switch (action.type) {
    case 'life':
      return { label: `${name} life`, groupKey: `life:${seat}` };
    case 'set-life':
      return { label: `${name} set life`, groupKey: `set:${seat}` };
    case 'poison':
      return { label: `${name} poison`, groupKey: `poison:${seat}` };
    case 'cmd-dmg':
      return { label: `${name} cmdr damage`, groupKey: `cmd:${seat}` };
    case 'eliminate':
      return {
        label: `${name} ${action.eliminated ? 'concede' : 'revive'}`,
        groupKey: `elim:${seat}`,
      };
    default:
      return { label: 'change', groupKey: 'x' };
  }
}

/**
 * Record the pre-action state if `action` is undoable. Coalesces a rapid
 * burst of the same kind on the same seat (e.g. tap-holding −1) into the
 * single snapshot taken before the burst started, so one Undo reverses the
 * whole burst — matching how the timeline groups them.
 */
export function capture(gameId: string, game: GameState, action: GameAction): void {
  if (suppressed || !isUndoable(action)) return;
  const stack = stacks.get(gameId) ?? [];
  const { label, groupKey } = labelFor(action, game);
  const top = stack[stack.length - 1];
  const now = Date.now();
  if (top && top.groupKey === groupKey && now - top.ts <= GROUP_WINDOW_MS) {
    top.ts = now; // extend the burst window; keep the original pre-burst snapshot
    return;
  }
  stack.push({ players: snap(game), label, groupKey, ts: now });
  if (stack.length > MAX_DEPTH) stack.shift();
  stacks.set(gameId, stack);
}

export function canUndo(gameId: string): boolean {
  return (stacks.get(gameId)?.length ?? 0) > 0;
}

export function peekLabel(gameId: string): string | null {
  const stack = stacks.get(gameId);
  return stack && stack.length > 0 ? stack[stack.length - 1].label : null;
}

/**
 * Pop the latest snapshot and return the compensating actions that restore
 * the affected seats to it, diffed against `current`. Returns [] if there's
 * nothing to undo. The caller dispatches these via the normal path; capture
 * is suppressed for the duration so the undo itself isn't pushed.
 */
export function popRestore(gameId: string, current: GameState): GameAction[] {
  const stack = stacks.get(gameId);
  if (!stack || stack.length === 0) return [];
  const snapshot = stack.pop()!;
  stacks.set(gameId, stack);

  const actions: GameAction[] = [];
  for (const before of snapshot.players) {
    const now = current.players.find((p) => p.seat === before.seat);
    if (!now) continue;

    // 1. Poison counter (delta; clamps ≥0 in the reducer, doesn't touch life).
    if (now.poison !== before.poison) {
      actions.push({
        type: 'poison',
        seat: before.seat,
        delta: before.poison - now.poison,
        actorSeat: before.seat,
      });
    }

    // 2. Commander-damage counters (delta). Each cmd-dmg delta *also* shifts
    //    life in the reducer, so we restore the counters first and then pin
    //    life absolutely in step 3.
    let cmdTouched = false;
    const fromSeats = new Set<number>([
      ...Object.keys(before.commanderDamage).map(Number),
      ...Object.keys(now.commanderDamage).map(Number),
    ]);
    for (const from of fromSeats) {
      const b = before.commanderDamage[from] ?? 0;
      const n = now.commanderDamage[from] ?? 0;
      if (b !== n) {
        cmdTouched = true;
        actions.push({
          type: 'cmd-dmg',
          seat: before.seat,
          fromSeat: from,
          delta: b - n,
          actorSeat: before.seat,
        });
      }
    }

    // 3. Pin life to the snapshot value (fixes both direct life changes and
    //    the life side-effect of the cmd-dmg corrections above).
    if (now.life !== before.life || cmdTouched) {
      actions.push({
        type: 'set-life',
        seat: before.seat,
        value: before.life,
        actorSeat: before.seat,
      });
    }

    // 4. Restore the eliminated flag last (reviving after life is back ≥1
    //    so the reducer's auto-eliminate doesn't immediately re-kill).
    if (now.eliminated !== before.eliminated) {
      actions.push({ type: 'eliminate', seat: before.seat, eliminated: before.eliminated });
    }
  }
  return actions;
}

/** Run `fn` with capture suppressed (used while applying an undo). */
export function runSuppressed(fn: () => void): void {
  suppressed = true;
  try {
    fn();
  } finally {
    suppressed = false;
  }
}

export function clearUndo(gameId: string): void {
  stacks.delete(gameId);
}
