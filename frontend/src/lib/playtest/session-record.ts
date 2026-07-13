/**
 * Playtest session records (E141) — a compact per-game summary derived from
 * the E140 game log + final reducer state, so cross-session analytics (kill
 * rate, land-drop consistency, opponent-interaction survival) can accumulate
 * without replaying full games.
 *
 * Pure derivation only — no localStorage here (see `session-history.ts`) and
 * no store/React coupling. Every function takes plain data in, returns plain
 * data out, mirroring `playtest-stats.ts`'s decoupling.
 */

import type { GameLogEntry } from './game-log';
import type { PlaytestState } from './types';
import { isOpponentDefeated } from './life-config';
import { isPlaytestLand } from '@/playtest/lib/zones';
import type { Deck } from '@/store/decks';

export interface PlaytestSessionRecord {
  id: string;
  deckId: string;
  endedAt: number;
  /** Final turn number reached this session. */
  turns: number;
  mulligans: number;
  /** `state.tableDefeatedTurn` — null if the table was never swept. */
  killTurn: number | null;
  opponentCount: number;
  opponentsDefeated: number;
  resistance: boolean;
  /** Opponent interaction survived, tallied from 'resistance' log entries —
   *  see `countResistanceEvents` for the exact text-matching this relies on. */
  resistanceCounters: number;
  resistanceRemovals: number;
  resistanceBounces: number;
  resistanceWipesSurvived: number;
  /** Land-drop honesty window: only the first `landDropTurnsChecked` turns are
   *  evaluated (curve consistency matters most early, and it caps the cost of
   *  scanning a long game's log). 0 when there weren't enough turns to check. */
  landDropsHit: number;
  landDropsMissed: number;
  landDropTurnsChecked: number;
  /** Null when the deck's original size wasn't available at capture time. */
  cardsDrawn: number | null;
}

export interface SessionAggregates {
  sessionsPlayed: number;
  medianKillTurn: number | null;
  bestKillTurn: number | null;
  /** Fraction (0..1) of sessions that ended in a table defeat. */
  killRate: number;
  avgMulligans: number;
  /** Fraction (0..1) of checked turns with no land played, pooled across every
   *  session with a checkable window. Null when no session has one. */
  landDropMissRate: number | null;
  /** Fraction (0..1) of Resistance-on sessions that survived >=1 board wipe.
   *  Null when no session had Resistance on. */
  wipeSurvivalRate: number | null;
  /** Kill turn -> count, sorted ascending, zero-count turns omitted. */
  killTurnHistogram: Array<{ turn: number; count: number }>;
}

/** Sessions below this count don't get rate/median stats shown — see
 *  `formatVsAverageLine` and the History tab's own gate. */
export const MIN_SESSIONS_FOR_STATS = 3;

/** Land-drop counting only looks at the first N turns of a session. */
export const MAX_LAND_DROP_TURNS_CHECKED = 10;

/**
 * A session is only worth recording once something actually happened —
 * otherwise every reflexive Reset (misclick, testing the opening hand) would
 * pollute a deck's track record. Deliberately narrow: a turn has passed, or
 * something reached the battlefield.
 */
export function isMeaningfulSession(state: Pick<PlaytestState, 'turn' | 'battlefield'>): boolean {
  return state.turn > 1 || state.battlefield.length > 0;
}

/**
 * The game log spans every Reset in a session's lifetime (E140 keeps it as
 * one continuous journal with 'reset' markers, not per-game slices). A
 * session record must only look at what happened *since* the last reset.
 */
export function sessionLogSegment(log: readonly GameLogEntry[]): readonly GameLogEntry[] {
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].kind === 'reset') return log.slice(i + 1);
  }
  return log;
}

/** Every land name in `deck` (mainboard + commander(s)), for cardName-based
 *  land-drop detection — the log only records a played card's name, not its
 *  type line, so detection has to go through the deck list. */
export function buildLandNameSet(
  deck: Pick<Deck, 'cards' | 'commander' | 'partnerCommander'> | undefined
): Set<string> {
  const names = new Set<string>();
  if (!deck) return names;
  for (const slot of deck.cards) {
    if (isPlaytestLand(slot.card.type_line)) names.add(slot.card.name);
  }
  for (const commander of [deck.commander, deck.partnerCommander]) {
    if (commander && isPlaytestLand(commander.type_line)) names.add(commander.name);
  }
  return names;
}

export interface LandDropTally {
  hit: number;
  missed: number;
  turnsChecked: number;
}

/**
 * Land-drop hit/miss over the first `maxTurn` turns: a turn "hits" if any
 * 'play' log entry that turn names a land (per `isLandName`). This is an
 * honest approximation, not a rules engine — it can't see a land drawn but
 * never played on time within the same turn's later actions, and treats any
 * land play (not just the "first" one, since the log doesn't mark that) as
 * satisfying the turn. Good enough for a curve-consistency signal, not a
 * substitute for reviewing the actual game.
 */
export function countLandDrops(
  log: readonly GameLogEntry[],
  finalTurn: number,
  isLandName: (cardName: string) => boolean,
  maxTurn: number = MAX_LAND_DROP_TURNS_CHECKED
): LandDropTally {
  const turnsChecked = Math.max(0, Math.min(finalTurn, maxTurn));
  if (turnsChecked === 0) return { hit: 0, missed: 0, turnsChecked: 0 };
  const turnsWithLand = new Set<number>();
  for (const entry of log) {
    if (
      entry.kind === 'play' &&
      entry.cardName &&
      entry.turn <= turnsChecked &&
      isLandName(entry.cardName)
    ) {
      turnsWithLand.add(entry.turn);
    }
  }
  let hit = 0;
  for (let turn = 1; turn <= turnsChecked; turn++) {
    if (turnsWithLand.has(turn)) hit++;
  }
  return { hit, missed: turnsChecked - hit, turnsChecked };
}

export interface ResistanceEventTally {
  counters: number;
  removals: number;
  bounces: number;
  wipesSurvived: number;
}

/**
 * Classifies each 'resistance' log entry by the verb `applyResistance` baked
 * into its message (see `lib/resistance.ts` EFFECT_VERB / the wipe message) —
 * the log only stores the rendered text, not a structured effect, so this
 * necessarily depends on that exact phrasing staying in sync with resistance.ts.
 */
export function countResistanceEvents(log: readonly GameLogEntry[]): ResistanceEventTally {
  let counters = 0;
  let removals = 0;
  let bounces = 0;
  let wipesSurvived = 0;
  for (const entry of log) {
    if (entry.kind !== 'resistance') continue;
    if (entry.text.includes('the board is wiped')) wipesSurvived++;
    else if (entry.text.includes('is countered')) counters++;
    else if (entry.text.includes('is destroyed')) removals++;
    else if (entry.text.includes('returned to hand')) bounces++;
  }
  return { counters, removals, bounces, wipesSurvived };
}

export interface DeriveSessionRecordInput {
  deckId: string;
  /** Full log, possibly spanning multiple resets — sliced internally to the
   *  current session via `sessionLogSegment`. */
  log: readonly GameLogEntry[];
  state: Omit<PlaytestState, 'past'>;
  mulliganCount: number;
  resistance: boolean;
  /** Original deck size, for the `cardsDrawn` count. Null when unknown. */
  deckSize: number | null;
  isLandName: (cardName: string) => boolean;
}

export function deriveSessionRecord(input: DeriveSessionRecordInput): PlaytestSessionRecord {
  const { state } = input;
  const segment = sessionLogSegment(input.log);
  const opponentsDefeated = state.opponents.filter((o) =>
    isOpponentDefeated(o, state.commanderDamageThreshold)
  ).length;
  const resistanceEvents = countResistanceEvents(segment);
  const landDrops = countLandDrops(segment, state.turn, input.isLandName);
  const battlefieldNonToken = state.battlefield.filter((b) => !b.card.isToken).length;
  const cardsDrawn =
    input.deckSize !== null
      ? input.deckSize -
        state.zones.library.length -
        state.zones.hand.length -
        state.zones.graveyard.length -
        state.zones.exile.length -
        battlefieldNonToken
      : null;

  return {
    id: `${input.deckId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deckId: input.deckId,
    endedAt: Date.now(),
    turns: state.turn,
    mulligans: input.mulliganCount,
    killTurn: state.tableDefeatedTurn,
    opponentCount: state.opponents.length,
    opponentsDefeated,
    resistance: input.resistance,
    resistanceCounters: resistanceEvents.counters,
    resistanceRemovals: resistanceEvents.removals,
    resistanceBounces: resistanceEvents.bounces,
    resistanceWipesSurvived: resistanceEvents.wipesSurvived,
    landDropsHit: landDrops.hit,
    landDropsMissed: landDrops.missed,
    landDropTurnsChecked: landDrops.turnsChecked,
    cardsDrawn,
  };
}

function median(nums: readonly number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeSessionAggregates(
  records: readonly PlaytestSessionRecord[]
): SessionAggregates {
  const n = records.length;
  const killTurns = records
    .map((r) => r.killTurn)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  const landRecords = records.filter((r) => r.landDropTurnsChecked > 0);
  const resistanceRecords = records.filter((r) => r.resistance);

  const histogramCounts = new Map<number, number>();
  for (const turn of killTurns) histogramCounts.set(turn, (histogramCounts.get(turn) ?? 0) + 1);
  const killTurnHistogram = [...histogramCounts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([turn, count]) => ({ turn, count }));

  return {
    sessionsPlayed: n,
    medianKillTurn: median(killTurns),
    bestKillTurn: killTurns.length > 0 ? killTurns[0] : null,
    killRate: n > 0 ? killTurns.length / n : 0,
    avgMulligans: n > 0 ? records.reduce((sum, r) => sum + r.mulligans, 0) / n : 0,
    landDropMissRate:
      landRecords.length > 0
        ? landRecords.reduce((sum, r) => sum + r.landDropsMissed, 0) /
          landRecords.reduce((sum, r) => sum + r.landDropTurnsChecked, 0)
        : null,
    wipeSurvivalRate:
      resistanceRecords.length > 0
        ? resistanceRecords.filter((r) => r.resistanceWipesSurvived > 0).length /
          resistanceRecords.length
        : null,
    killTurnHistogram,
  };
}

/** "Turn 8 kill" / "Turn 5 — game ended" for the end-of-session summary's headline. */
export function sessionHeadline(record: PlaytestSessionRecord): string {
  return record.killTurn !== null
    ? `Turn ${record.killTurn} kill`
    : `Turn ${record.turns} — game ended`;
}

/**
 * "1 mulligan · survived 2 removals + 1 wipe · 0 missed land drops" —
 * mid-dot-joined, only the parts that apply. Counter/destroy/bounce are
 * folded into one "removals" figure for the compact one-liner (the
 * record itself keeps them separate for anyone reading the raw schema).
 */
export function formatSessionSummaryLine(record: PlaytestSessionRecord): string {
  const parts: string[] = [];
  if (record.mulligans > 0) {
    parts.push(`${record.mulligans} mulligan${record.mulligans === 1 ? '' : 's'}`);
  }
  if (record.resistance) {
    const survived: string[] = [];
    const removalsTotal =
      record.resistanceCounters + record.resistanceRemovals + record.resistanceBounces;
    if (removalsTotal > 0) {
      survived.push(`${removalsTotal} removal${removalsTotal === 1 ? '' : 's'}`);
    }
    if (record.resistanceWipesSurvived > 0) {
      survived.push(
        `${record.resistanceWipesSurvived} wipe${record.resistanceWipesSurvived === 1 ? '' : 's'}`
      );
    }
    if (survived.length > 0) parts.push(`survived ${survived.join(' + ')}`);
  }
  if (record.landDropTurnsChecked > 0) {
    parts.push(
      `${record.landDropsMissed} missed land drop${record.landDropsMissed === 1 ? '' : 's'}`
    );
  }
  return parts.length > 0
    ? parts.join(' · ')
    : `${record.turns} turn${record.turns === 1 ? '' : 's'} played`;
}

/** "your median kill: turn 9" once there's enough history to say anything
 *  honest — null before `MIN_SESSIONS_FOR_STATS` sessions or with no kills yet. */
export function formatVsAverageLine(aggregates: SessionAggregates): string | null {
  if (aggregates.sessionsPlayed < MIN_SESSIONS_FOR_STATS || aggregates.medianKillTurn === null) {
    return null;
  }
  return `your median kill: turn ${aggregates.medianKillTurn}`;
}
