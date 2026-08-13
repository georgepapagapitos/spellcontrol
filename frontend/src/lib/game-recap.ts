/**
 * "The story of the game" — a short list of narrative stats derived from a
 * finished game's event log, for display in the post-game overlay. Pure and
 * read-only: never mutates `game`, never dispatches.
 *
 * Reuses `summarizeGame` (from `@spellcontrol/game-core`) for the stats it
 * already computes correctly — turn count, first blood, and each seat's
 * running-life reconstruction (`lowestLife`, which already handles
 * `set-life`'s absolute-value semantics via its own burst tracker) — rather
 * than re-deriving them here.
 *
 * Absent-data discipline: a stat whose supporting events don't exist is
 * OMITTED, never rendered as 0/unknown. A recap can legitimately have as few
 * as zero stats (see `GameRecap`, which then renders nothing).
 *
 * Truncation guard: `events` is capped at MAX_EVENTS=500 (packages/game-core).
 * When the log has been trimmed (`events[0]?.kind !== 'start'`), stats that
 * depend on the FULL history from the game's start are dropped — first blood
 * (is this really the first hit, or just the first one still in the window?)
 * and the comeback (the running-life reconstruction assumes it starts at
 * `startingLife`, which is only true if nothing was evicted). Because
 * truncation only ever evicts from the FRONT (oldest first), any stat built
 * from the most recent events — game length via timestamps, the biggest hit
 * within the window, eliminations, designations — stays honest.
 */
import { summarizeGame, type GameState } from './game-state';

export interface RecapStat {
  id: string;
  label: string;
  detail: string;
}

function nameOf(game: GameState, seat: number): string {
  return game.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
}

function humanizeDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  if (min < 1) return `${totalSec}s`;
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface HitCandidate {
  amount: number;
  /** True attacker, or null when the event carries no honest attribution
   *  (a self-tapped `life` event — see the module doc on `actorSeat`). */
  dealerSeat: number | null;
  targetSeat: number;
}

/**
 * The hardest single swing in the log: the largest `cmd-dmg` gain (a real
 * dealer via `fromSeat`) or the largest `life` loss (attributed only when
 * `actorSeat` differs from the victim — otherwise it's just a self-tap).
 */
function findBiggestHit(game: GameState): HitCandidate | null {
  let best: HitCandidate | null = null;
  for (const ev of game.events) {
    if (ev.kind === 'cmd-dmg' && typeof ev.delta === 'number' && ev.delta > 0) {
      if (ev.targetSeat == null || ev.fromSeat == null) continue;
      if (!best || ev.delta > best.amount) {
        best = { amount: ev.delta, dealerSeat: ev.fromSeat, targetSeat: ev.targetSeat };
      }
    } else if (ev.kind === 'life' && typeof ev.delta === 'number' && ev.delta < 0) {
      if (ev.targetSeat == null) continue;
      const amount = -ev.delta;
      const dealerSeat =
        ev.actorSeat != null && ev.actorSeat !== ev.targetSeat ? ev.actorSeat : null;
      if (!best || amount > best.amount) {
        best = { amount, dealerSeat, targetSeat: ev.targetSeat };
      }
    }
  }
  return best;
}

/** Seats in the order they fell, restricted to seats still eliminated at the
 *  end (a `revive` un-does a pending elimination — see `summary.ts`'s own
 *  `elimOrder` for the same discipline) and reset when a mid-log `reset`
 *  starts a fresh game on the same log. */
function eliminationOrder(game: GameState): number[] {
  let order: number[] = [];
  for (const ev of game.events) {
    if (ev.kind === 'reset') {
      order = [];
    } else if (ev.kind === 'eliminate' && ev.targetSeat != null) {
      order.push(ev.targetSeat);
    } else if (ev.kind === 'revive' && ev.targetSeat != null) {
      const idx = order.lastIndexOf(ev.targetSeat);
      if (idx !== -1) order.splice(idx, 1);
    }
  }
  const stillOut = new Set(game.players.filter((p) => p.eliminated).map((p) => p.seat));
  return order.filter((seat) => stillOut.has(seat));
}

/**
 * Who last held a table designation (Monarch / Initiative), and whether it
 * was contested. Reads the live `game.designations` field for the final
 * holder (recency-safe under truncation) and only fires when the mechanic
 * was actually used this game — a never-touched designation stays null and
 * is correctly indistinguishable from "not tracked".
 */
function designationStat(
  game: GameState,
  kind: 'monarch' | 'initiative',
  label: string
): RecapStat | null {
  const holder = game.designations[kind];
  if (holder == null) return null;
  const claims = game.events.filter((e) => e.kind === 'designation' && e.message === kind).length;
  if (claims === 0) return null;
  const name = nameOf(game, holder);
  const detail =
    claims > 1
      ? `${name} held it at the end, after it changed hands ${claims} times.`
      : `${name} claimed it and never let go.`;
  return { id: `designation-${kind}`, label, detail };
}

export function buildGameRecap(game: GameState): RecapStat[] {
  const stats: RecapStat[] = [];
  // MAX_EVENTS evicts from the front only, so a non-'start' first event means
  // earlier history is gone — see the truncation-guard doc above.
  const truncated = game.events.length > 0 && game.events[0].kind !== 'start';
  const summary = summarizeGame(game, game.endedAt ?? Date.now());

  if (game.endedAt != null) {
    stats.push({
      id: 'length',
      label: 'Game length',
      detail: humanizeDuration(game.endedAt - game.createdAt),
    });
  }

  if (summary.turns > 0 && game.players.length > 0) {
    const rounds = Math.max(1, Math.ceil(summary.turns / game.players.length));
    stats.push({
      id: 'rounds',
      label: 'Rounds',
      detail: `${rounds} round${rounds === 1 ? '' : 's'} (${summary.turns} turn${summary.turns === 1 ? '' : 's'})`,
    });
  }

  if (!truncated && summary.firstBlood) {
    const { seat, bySeat, amount } = summary.firstBlood;
    stats.push({
      id: 'first-blood',
      label: 'First blood',
      detail:
        bySeat != null
          ? `${nameOf(game, bySeat)} drew first blood on ${nameOf(game, seat)}, for ${amount}.`
          : `${nameOf(game, seat)} took the game's first hit, for ${amount}.`,
    });
  }

  const hit = findBiggestHit(game);
  if (hit) {
    stats.push({
      id: 'biggest-hit',
      label: 'Biggest hit',
      detail:
        hit.dealerSeat != null
          ? `${nameOf(game, hit.dealerSeat)} hit ${nameOf(game, hit.targetSeat)} for ${hit.amount} in one swing.`
          : `${nameOf(game, hit.targetSeat)} took ${hit.amount} in one swing.`,
    });
  }

  if (!truncated && game.winnerSeat != null) {
    const winnerSummary = summary.seats.find((s) => s.seat === game.winnerSeat);
    const threshold = Math.max(5, game.startingLife * 0.25);
    if (winnerSummary && winnerSummary.lowestLife <= threshold) {
      stats.push({
        id: 'comeback',
        label: 'The comeback',
        detail: `${nameOf(game, game.winnerSeat)} won from as low as ${winnerSummary.lowestLife} life.`,
      });
    }
  }

  const order = eliminationOrder(game);
  if (order.length > 0) {
    const names = order.map((seat) => nameOf(game, seat));
    stats.push({
      id: 'eliminations',
      label: 'Eliminations',
      detail:
        names.length === 1
          ? `${names[0]} fell first.`
          : `${names.join(', then ')} — in that order.`,
    });
  }

  const monarch = designationStat(game, 'monarch', 'The Monarch');
  if (monarch) stats.push(monarch);
  const initiative = designationStat(game, 'initiative', 'The Initiative');
  if (initiative) stats.push(initiative);

  return stats;
}
