// The horde table's step log: what one `horde-step` / `horde-undo` does to a
// `HordeTable`. Split out of index.ts (which re-exports it) to keep the
// reducer file under its size ceiling. Pure, table in and table out; the
// shared life total and the event log stay in `applyAction`.

import type { HordeLogEntry, HordeStep, HordeTable } from './horde-types';

/** Bound on `HordeTable.steps` — same storage-bound reasoning as
 *  `MAX_COUNTERS_PER_SCOPE`: an online game's whole state is one JSONB row. */
export const MAX_HORDE_STEPS = 2000;

/**
 * Whether `steps[i]` is the `take 0` a passing confirm (`{ k: 'confirm',
 * pass: true }`) logged with it: the horde had nothing to attack with, so the
 * turn passed without a combat stop (E1037). Undo takes the pair back as one
 * step, and nobody "took" anything, so the table doesn't announce it as a hit.
 * Only a `take` of 0 counts: the reducer never logs another after a pass, and
 * a crafted one must undo with its life restored, like any take.
 */
export function isHordePassTake(steps: readonly HordeLogEntry[], i: number): boolean {
  const entry = steps[i];
  const before = steps[i - 1];
  return (
    entry?.k === 'take' && entry.dealt === 0 && before?.k === 'confirm' && before.pass === true
  );
}

export interface HordeStepResult {
  horde: HordeTable;
  /** Shared life a `take` lowers, when the step was one. */
  dealt?: number;
}

/** What a combat-ending `take` does to the table (life is the caller's). */
function endCombat(horde: HordeTable, steps: HordeLogEntry[]): HordeTable {
  return { ...horde, phase: 'survivors', survivorTurn: horde.survivorTurn + 1, done: [], steps };
}

/**
 * Append one step to the log. `null` when the step doesn't apply in the
 * table's phase (the caller treats it as a no-op, like a stale `at`); throws
 * on a malformed step or a full log.
 */
export function stepHorde(
  horde: HordeTable,
  step: HordeStep,
  seat: number,
  ts: number
): HordeStepResult | null {
  const pass = step.k === 'confirm' && step.pass === true;
  if (horde.steps.length + (pass ? 2 : 1) > MAX_HORDE_STEPS) {
    throw new Error(`Horde log is at its ${MAX_HORDE_STEPS}-step limit.`);
  }
  const entry: HordeLogEntry = { ...step, seat, ts };
  const steps = [...horde.steps, entry];

  switch (step.k) {
    case 'reveal':
      // The "start without them" path: skip past a stuck team-done wait.
      if (horde.phase !== 'survivors') return null;
      return {
        horde: { ...horde, hordeTurn: horde.hordeTurn + 1, phase: 'reveal', done: [], steps },
      };
    case 'confirm':
      if (horde.phase !== 'reveal') return null;
      // A passing confirm logs the `take 0` Skip would have, in the same
      // action: one `at` check covers both entries, so a second seat's confirm
      // of the same reveal is stale, and a replay of the log reads exactly what
      // a Skip writes. Nothing attacked, so there is no hit (no `dealt`).
      if (pass) return { horde: endCombat(horde, [...steps, { k: 'take', dealt: 0, seat, ts }]) };
      return { horde: { ...horde, phase: 'combat', steps } };
    case 'take':
      if (horde.phase !== 'combat') return null;
      if (!Number.isInteger(step.dealt) || step.dealt < 0 || step.dealt > 999) {
        throw new Error('A horde attack must deal 0-999 damage.');
      }
      return { horde: endCombat(horde, steps), dealt: step.dealt };
    case 'damage':
      if (!Number.isInteger(step.n) || step.n < 0 || step.n > 999) {
        throw new Error('Horde damage must be 0-999.');
      }
      return { horde: { ...horde, steps } };
    case 'move':
      if (!step.cardId || step.cardId.length > 80) {
        throw new Error('A horde card move needs a card id of at most 80 characters.');
      }
      if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'library') {
        throw new Error(`Unknown horde move destination "${step.to}".`);
      }
      return { horde: { ...horde, steps } };
  }
}

export interface HordeUndoResult {
  horde: HordeTable;
  /** Shared life to give back (the undone `take`'s `dealt`). */
  restore?: number;
}

/**
 * Take the log's last step back. A passing confirm's pair goes back together,
 * to the reveal, the way the paper table's one undo step does. `survivors` is
 * every active seat, the team that had to be done for a reveal to happen.
 */
export function undoHorde(horde: HordeTable, survivors: number[]): HordeUndoResult {
  const n = horde.steps.length;
  const last = horde.steps[n - 1];
  const steps = horde.steps.slice(0, -1);

  switch (last.k) {
    case 'take': {
      const back = { ...horde, survivorTurn: horde.survivorTurn - 1, done: [] };
      if (isHordePassTake(horde.steps, n - 1)) {
        return { horde: { ...back, phase: 'reveal', steps: steps.slice(0, -1) } };
      }
      // An active game never has a clamped take (hitting 0 ends the game,
      // and horde-undo requires 'active'), so adding `dealt` back is exact.
      return { horde: { ...back, phase: 'combat', steps }, restore: last.dealt };
    }
    case 'confirm':
      return { horde: { ...horde, phase: 'reveal', steps } };
    case 'reveal':
      return {
        horde: {
          ...horde,
          phase: 'survivors',
          hordeTurn: horde.hordeTurn - 1,
          done: survivors,
          steps,
        },
      };
    case 'damage':
    case 'move':
      return { horde: { ...horde, steps } };
  }
}
