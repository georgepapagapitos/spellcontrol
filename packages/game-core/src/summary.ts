/**
 * Derived per-game statistics, computed from the event log rather than tracked
 * as extra state. Pure and isomorphic like the reducer itself: the client runs
 * it to render live in-game stats, and the server runs it once at persist time
 * so cross-game playgroup rollups (pod leaderboards, head-to-head) read a
 * compact record instead of re-walking every game's log.
 *
 * ## What can and can't be attributed
 *
 * A `life` event's `actorSeat` is the *panel's own owner* — players tap their
 * own life down, so the log has no record of who dealt the damage. Only
 * `cmd-dmg` carries a true dealer (`fromSeat`). Everything here is therefore
 * either victim-side (damage taken, lowest life, biggest hit), exactly
 * attributed (the commander-damage matrix), or credited by the turn marker:
 * whoever held the turn when a seat died gets the KO. That heuristic is right
 * far more often than not in Commander — you kill people on your own turn —
 * but it only produces anything at all when the pod actually passes turns, so
 * every turn-derived field is nullable and reads as "not tracked", never 0.
 */

import type { GameEvent, GameState } from './index';

/**
 * Consecutive life losses on one seat inside this window count as a single
 * hit. A 14-point attack is normally entered as a burst of taps, not one
 * event; this matches the game log's own grouping window, so the number
 * reported as the biggest hit is the number the timeline shows as one row.
 */
const BURST_WINDOW_MS = 2000;

export interface SeatSummary {
  seat: number;
  /** Life lost across the game — life decrements plus commander damage. */
  damageTaken: number;
  /** Life gained across the game. */
  lifeGained: number;
  /** Largest single burst of life loss (see `BURST_WINDOW_MS`). */
  biggestHit: number;
  /** Lowest life total this seat ever reached. */
  lowestLife: number;
  /** Commander damage this seat dealt, summed over every opponent. */
  commanderDamageDealt: number;
  /** 1 = won. `null` while the seat is still alive in an unfinished game. */
  placement: number | null;
  /** Turn the seat was eliminated on. `null` if it survived, or if the pod
   *  never passed turns. */
  eliminatedOnTurn: number | null;
  /** Seat holding the turn marker when this seat died — the KO credit
   *  heuristic. `null` when turns aren't tracked or the seat killed itself. */
  killedBySeat: number | null;
}

export interface FirstBlood {
  /** Seat that took the game's first damage. */
  seat: number;
  /** Seat holding the turn marker at that moment — who drew it. `null` when
   *  turn tracking isn't in use. */
  bySeat: number | null;
  /** Turn it happened on, or `null` when turn tracking isn't in use. */
  turn: number | null;
  ts: number;
  amount: number;
}

/** One dealer→victim commander-damage total. Only non-zero pairs are listed. */
export interface CommanderDamageEdge {
  fromSeat: number;
  toSeat: number;
  amount: number;
}

export interface GameSummary {
  /** Turns taken (turn-marker moves). 0 when the pod never passes turns. */
  turns: number;
  durationMs: number;
  firstBlood: FirstBlood | null;
  winnerSeat: number | null;
  /** One entry per seat, in seat order. */
  seats: SeatSummary[];
  commanderDamage: CommanderDamageEdge[];
}

interface SeatAcc {
  damageTaken: number;
  lifeGained: number;
  biggestHit: number;
  lowestLife: number;
  commanderDamageDealt: number;
  /** Running life loss inside the current burst window. */
  burst: number;
  /** Timestamp of the last life loss, for burst continuation. */
  burstTs: number;
}

/**
 * Reduce a game's event log to its summary. Safe to call at any status — an
 * unfinished game yields partial stats (null placements for the living), and a
 * game with no events yields zeroed seats with a null `firstBlood`.
 */
export function summarizeGame(state: GameState, now: number = Date.now()): GameSummary {
  const seats = state.players.map((p) => p.seat);
  const life = new Map<number, number>();
  const acc = new Map<number, SeatAcc>();
  const reset = () => {
    for (const seat of seats) {
      life.set(seat, state.startingLife);
      acc.set(seat, {
        damageTaken: 0,
        lifeGained: 0,
        biggestHit: 0,
        lowestLife: state.startingLife,
        commanderDamageDealt: 0,
        burst: 0,
        burstTs: -Infinity,
      });
    }
  };
  reset();

  let turns = 0;
  let activeSeat: number | null = null;
  let firstBlood: FirstBlood | null = null;
  const cmdEdges = new Map<string, CommanderDamageEdge>();
  let elimOrder: { seat: number; turn: number | null; by: number | null }[] = [];

  /** Apply a signed life change, updating the victim-side accumulators. */
  const applyLife = (seat: number, delta: number, ts: number) => {
    const cur = life.get(seat);
    const a = acc.get(seat);
    if (cur == null || !a || delta === 0) return;
    const nextLife = cur + delta;
    life.set(seat, nextLife);
    if (nextLife < a.lowestLife) a.lowestLife = nextLife;
    if (delta > 0) {
      a.lifeGained += delta;
      // Healing breaks the burst — the next hit starts a fresh one.
      a.burstTs = -Infinity;
      return;
    }
    const loss = -delta;
    a.damageTaken += loss;
    a.burst = ts - a.burstTs <= BURST_WINDOW_MS ? a.burst + loss : loss;
    a.burstTs = ts;
    if (a.burst > a.biggestHit) a.biggestHit = a.burst;
  };

  const noteFirstBlood = (seat: number, amount: number, ts: number) => {
    if (firstBlood || amount <= 0) return;
    firstBlood = {
      seat,
      bySeat: activeSeat != null && activeSeat !== seat ? activeSeat : null,
      turn: turns > 0 ? turns : null,
      ts,
      amount,
    };
  };

  for (const ev of state.events) {
    switch (ev.kind) {
      case 'reset':
        // A reset starts a fresh game on the same log — everything before it
        // describes a game that no longer exists.
        reset();
        turns = 0;
        activeSeat = null;
        firstBlood = null;
        cmdEdges.clear();
        elimOrder = [];
        break;
      case 'start':
        for (const seat of seats) life.set(seat, state.startingLife);
        break;
      case 'life': {
        if (ev.targetSeat == null || typeof ev.delta !== 'number') break;
        applyLife(ev.targetSeat, ev.delta, ev.ts);
        noteFirstBlood(ev.targetSeat, -ev.delta, ev.ts);
        break;
      }
      case 'set-life': {
        // `delta` carries the absolute new value for this kind.
        if (ev.targetSeat == null || typeof ev.delta !== 'number') break;
        const cur = life.get(ev.targetSeat);
        if (cur == null) break;
        applyLife(ev.targetSeat, ev.delta - cur, ev.ts);
        noteFirstBlood(ev.targetSeat, cur - ev.delta, ev.ts);
        break;
      }
      case 'cmd-dmg': {
        if (ev.targetSeat == null || typeof ev.delta !== 'number') break;
        applyLife(ev.targetSeat, -ev.delta, ev.ts);
        noteFirstBlood(ev.targetSeat, ev.delta, ev.ts);
        if (ev.fromSeat == null) break;
        const dealer = acc.get(ev.fromSeat);
        if (dealer) dealer.commanderDamageDealt += ev.delta;
        const key = `${ev.fromSeat}>${ev.targetSeat}`;
        const edge = cmdEdges.get(key);
        if (edge) edge.amount += ev.delta;
        else cmdEdges.set(key, { fromSeat: ev.fromSeat, toSeat: ev.targetSeat, amount: ev.delta });
        break;
      }
      case 'turn':
        turns += 1;
        activeSeat = ev.targetSeat;
        break;
      case 'eliminate': {
        if (ev.targetSeat == null) break;
        elimOrder.push({
          seat: ev.targetSeat,
          turn: turns > 0 ? turns : null,
          by: activeSeat != null && activeSeat !== ev.targetSeat ? activeSeat : null,
        });
        break;
      }
      case 'revive':
        // Undo the pending elimination so a mis-tap doesn't score a placement.
        elimOrder = dropLast(elimOrder, (e) => e.seat === ev.targetSeat);
        break;
    }
  }

  // Placement: first out finishes last. The winner takes 1st; seats still
  // alive in an unfinished game have no placement yet.
  const eliminatedNow = new Set(state.players.filter((p) => p.eliminated).map((p) => p.seat));
  const finalElims = elimOrder.filter((e) => eliminatedNow.has(e.seat));
  const total = state.players.length;
  const placement = new Map<number, number>();
  finalElims.forEach((e, i) => placement.set(e.seat, total - i));
  if (state.winnerSeat != null) placement.set(state.winnerSeat, 1);

  const elimBySeat = new Map(finalElims.map((e) => [e.seat, e]));

  return {
    turns,
    durationMs: state.startedAt ? (state.endedAt ?? now) - state.startedAt : 0,
    firstBlood,
    winnerSeat: state.winnerSeat,
    seats: state.players.map((p) => {
      const a = acc.get(p.seat)!;
      const elim = elimBySeat.get(p.seat);
      return {
        seat: p.seat,
        damageTaken: a.damageTaken,
        lifeGained: a.lifeGained,
        biggestHit: a.biggestHit,
        lowestLife: a.lowestLife,
        commanderDamageDealt: a.commanderDamageDealt,
        placement: placement.get(p.seat) ?? null,
        eliminatedOnTurn: elim?.turn ?? null,
        killedBySeat: elim?.by ?? null,
      };
    }),
    commanderDamage: [...cmdEdges.values()].filter((e) => e.amount > 0),
  };
}

/** Remove the last entry matching `match`, returning a new array. */
function dropLast<T>(list: T[], match: (item: T) => boolean): T[] {
  for (let i = list.length - 1; i >= 0; i--) {
    if (match(list[i])) return [...list.slice(0, i), ...list.slice(i + 1)];
  }
  return list;
}

/**
 * Event kinds worth showing by default in the in-game log. Everything else —
 * the long tail of ±1 life taps — stays available behind the log's "all
 * events" toggle. A big life swing is promoted into the default view by
 * `isKeyMoment` below rather than by kind.
 */
const KEY_KINDS: ReadonlySet<GameEvent['kind']> = new Set([
  'start',
  'end',
  'reset',
  'eliminate',
  'revive',
  'designation',
  'note',
  'settings',
  'join',
  'leave',
  'set-life',
]);

/** A life swing at or above this counts as a moment, not bookkeeping. */
export const KEY_SWING = 5;

/**
 * Whether a (possibly grouped) log row belongs in the default "key moments"
 * view. Lives here rather than in the frontend so the in-game log and any
 * server-side recap agree on what counts as a moment.
 */
export function isKeyMoment(row: { kind: GameEvent['kind']; delta?: number }): boolean {
  if (KEY_KINDS.has(row.kind)) return true;
  if (row.kind === 'life' || row.kind === 'cmd-dmg') {
    return Math.abs(row.delta ?? 0) >= KEY_SWING;
  }
  return false;
}
