/**
 * Table clocks, derived — not stored.
 *
 * Every number here is a pure function of state the reducer already keeps:
 * `startedAt` for the game, the `turn` events in the log for each turn, and
 * (since the `clock` action) the `clock` pause/resume events for the
 * stretches that don't count. That is the whole design. A stored, ticking
 * timer would need a reducer action per second (unusable for an online game,
 * which persists state on every action) and would then have to be
 * reconciled against the wall clock anyway — the wall clock is the source of
 * truth for how long a table has been sitting there, so read it directly.
 *
 * Wall-clock, deliberately: a phone that sleeps, backgrounds, or loses its
 * connection mid-game keeps counting, because the people at the table kept
 * playing. Pausing is the one thing that stops it, and only because a player
 * asked — `isClockPaused` (game-core) folds the log for whether that is true
 * right now, and every function below subtracts the paused stretches from
 * whatever interval it's summing. A pause that spans a turn change is handled
 * for free: each interval (a turn's stretch, the whole game) subtracts only
 * the paused time that falls inside *it*, so passing the turn mid-pause splits
 * the paused time correctly between the two turns without either function
 * knowing the other exists. A game that ends while paused freezes exactly
 * where it was: the interval's own end (`endedAt`) caps the subtraction, so
 * the still-open pause never bleeds into "how long the game ran".
 */

import { isClockPaused } from './game-state';
import type { GameEvent, GameState } from './game-state';

/**
 * Total paused milliseconds that fall inside `[from, to)`, folding the
 * `clock` events in `events` (assumed in the log's natural, ascending-ts
 * order — `pushEvent` only ever appends). A pause that started before `from`
 * (still open, or closed inside the window) and a pause still open at `to`
 * are both clipped to the window rather than dropped or double-counted.
 */
function pausedMsBetween(events: readonly GameEvent[], from: number, to: number): number {
  let paused = 0;
  let pauseStart: number | null = null;
  for (const e of events) {
    if (e.kind !== 'clock' || typeof e.paused !== 'boolean') continue;
    if (e.ts >= to) break;
    if (e.ts <= from) {
      pauseStart = e.paused ? e.ts : null;
      continue;
    }
    if (e.paused) {
      if (pauseStart == null) pauseStart = e.ts;
    } else if (pauseStart != null) {
      paused += e.ts - Math.max(pauseStart, from);
      pauseStart = null;
    }
  }
  if (pauseStart != null) paused += to - Math.max(pauseStart, from);
  return Math.max(0, paused);
}

/**
 * `mm:ss`, or `h:mm:ss` once a game runs past the hour — which commander
 * games routinely do. Negative and non-finite inputs floor to zero rather
 * than rendering "-1:-3", since every caller derives from a timestamp that
 * can legitimately be slightly ahead of `now` (clock skew on a synced online
 * game, a `ts` stamped by another device).
 *
 * Not to be merged with `formatDuration` in GameHistory.tsx: that one renders
 * a finished game's span coarsely ("12 min") for a history row, and dropping
 * seconds is the point there. A live clock needs the seconds.
 */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Spoken form for a screen reader — "12 minutes 4 seconds" reads, "12:04" does not. */
export function describeClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m > 0) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  // Keep seconds when they're the only unit, so a fresh turn reads "4 seconds"
  // rather than an empty string.
  if (s > 0 || parts.length === 0) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** Elapsed game time, or null when the game has not started. A finished game
 *  freezes at its final duration instead of ticking on past the last play.
 *  Excludes any paused stretch (see the module doc). */
export function gameElapsed(game: GameState, now: number): number | null {
  if (game.startedAt == null) return null;
  const end = game.endedAt ?? now;
  return Math.max(0, end - game.startedAt - pausedMsBetween(game.events, game.startedAt, end));
}

/**
 * When the current turn began: the most recent `turn` event, falling back to
 * the game's own start for the first turn (nobody has passed yet). Null when
 * the game hasn't started, so a lobby shows no turn clock.
 */
export function turnStartedAt(game: GameState): number | null {
  if (game.startedAt == null) return null;
  for (let i = game.events.length - 1; i >= 0; i--) {
    if (game.events[i].kind === 'turn') return game.events[i].ts;
  }
  return game.startedAt;
}

/** Elapsed time on the current turn, or null when there is no running turn.
 *  Excludes any paused stretch that falls within this turn. */
export function turnElapsed(game: GameState, now: number): number | null {
  const from = turnStartedAt(game);
  if (from == null) return null;
  const end = game.endedAt ?? now;
  return Math.max(0, end - from - pausedMsBetween(game.events, from, end));
}

/**
 * Total time each seat has held the turn, keyed by seat.
 *
 * Walks the `turn` events pairwise: each one names the seat that is taking
 * the turn, so the interval from that event to the *next* turn event (or to
 * `now` / the game's end for the last one) belongs to it. The stretch before
 * the very first `turn` event belongs to whoever the table recorded as going
 * first — `startingSeat` — and is dropped when nobody recorded it, because
 * attributing it to seat 0 would invent a fact (see `startingSeat`'s note in
 * game-core).
 *
 * Seats that never held a turn are absent rather than zero: "we never tracked
 * turns" and "this player took zero time" are different claims, and only the
 * caller knows which to render.
 *
 * Each stretch subtracts its own paused time (see the module doc) — a pause
 * that spans the moment a turn is passed is split correctly between the
 * outgoing and incoming seat because each stretch's subtraction only counts
 * what falls inside that stretch's own `[start, end)`.
 */
export function seatTurnTotals(game: GameState, now: number): Record<number, number> {
  const totals: Record<number, number> = {};
  const end = game.endedAt ?? now;
  const turns = game.events.filter((e) => e.kind === 'turn');

  const add = (seat: number | null | undefined, from: number, to: number) => {
    const ms = to - from - pausedMsBetween(game.events, from, to);
    if (seat == null || ms <= 0) return;
    totals[seat] = (totals[seat] ?? 0) + ms;
  };

  // The opening stretch, before anyone passed: credited to the recorded
  // first player only.
  if (game.startedAt != null) {
    add(game.startingSeat, game.startedAt, turns[0]?.ts ?? end);
  }
  for (let i = 0; i < turns.length; i++) {
    add(turns[i].targetSeat, turns[i].ts, turns[i + 1]?.ts ?? end);
  }
  return totals;
}

/**
 * Every derived clock reading in one call — total game time, whether it's
 * paused, the active seat and its turn time, and the per-seat turn totals.
 * The single entry point a clock-rendering component should read from, so a
 * redesigned board control never has to re-derive any of this by hand.
 */
export interface ClockView {
  /** Elapsed game time, or null before the game starts (see `gameElapsed`). */
  total: number | null;
  /** Whether the clock is paused right now (see `isClockPaused`). */
  paused: boolean;
  /** The seat currently holding the turn, or null if turns aren't tracked. */
  activeSeat: number | null;
  /** Elapsed time on `activeSeat`'s turn, or null (see `turnElapsed`). */
  turn: number | null;
  /** Total time each seat has held the turn so far (see `seatTurnTotals`). */
  seatTotals: Record<number, number>;
}

export function clockView(game: GameState, now: number): ClockView {
  return {
    total: gameElapsed(game, now),
    paused: isClockPaused(game),
    activeSeat: game.activeSeat,
    // The turn clock is only meaningful once turns are actually being
    // passed; a pod that never touches the marker has no turn reading, and
    // one equal to the whole game would be noise.
    turn: game.activeSeat != null ? turnElapsed(game, now) : null,
    seatTotals: seatTurnTotals(game, now),
  };
}
