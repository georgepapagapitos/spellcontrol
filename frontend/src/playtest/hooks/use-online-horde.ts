import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayStore } from '@/store/play';
import { toast } from '@/store/toasts';
import { bossTickPhrase, type HordeDamageResult } from '@/lib/horde';
import {
  isHordePassTake,
  type HordeLogEntry,
  type HordePhase,
  type HordeStep,
} from '@spellcontrol/game-core';
import type { PlaytestState } from '@/lib/playtest';
import type { Rect } from '@/playtest/lib/auto-place';
import { usePlaytestStore } from '@/playtest/store';
import type { HordeActions } from '../components/horde/horde-actions';
import type { OnlineTable } from './use-online-table';
import { useTableSeat } from './use-table-seat';
import { useHordeReplay, type HordeReplayStatus } from './use-horde-replay';
import type { HordeReplay } from '@/lib/horde';

export interface OnlineHordeTeam {
  phase: HordePhase;
  survivorTurn: number;
  setupTurns: number;
  hordeTurn: number;
  done: number[];
  /** Whether MY seat has marked itself done for this team turn. */
  iAmDone: boolean;
  /** Names of active (not eliminated, connected) survivors not yet done. */
  waitingOn: string[];
  inSetup: boolean;
}

export interface OnlineHordeResult {
  status: HordeReplayStatus;
  error: string | null;
  retry(): void;
  replay: HordeReplay | null;
  team: OnlineHordeTeam;
  actions: HordeActions;
  /** Marks (or un-marks) MY seat done for this team turn. */
  markDone(done: boolean): void;
  /** "Start without them" — ends the team turn without waiting on teammates. */
  startWithout(): void;
  /** Undoes the log's current last step, if any. */
  undoLast(): void;
  /** Human label for the log's last step, e.g. "8 damage to the horde",
   *  "the horde's attack", "the reveal", "Zombie destroyed" — for an Undo row. */
  lastStepLabel: string | null;
  /** `replay.lastDamage` when it's MY step and I haven't dismissed it. */
  damageResult: HordeDamageResult | null;
}

function findCardName(board: PlaytestState | null, cardId: string): string | null {
  if (!board) return null;
  const everywhere = [
    ...board.battlefield.map((b) => b.card),
    ...board.zones.graveyard,
    ...board.zones.exile,
    ...board.zones.library,
    ...board.zones.hand,
    ...board.zones.command,
  ];
  return everywhere.find((c) => c.id === cardId)?.name ?? null;
}

/** The same logged step, ignoring `ts`: an optimistic step is stamped on this
 *  device and its server copy on the server, so only the content can match. */
function sameStep(a: HordeLogEntry, b: HordeLogEntry): boolean {
  if (a.seat !== b.seat) return false;
  switch (a.k) {
    case 'take':
      return b.k === 'take' && a.dealt === b.dealt;
    case 'damage':
      return b.k === 'damage' && a.n === b.n;
    case 'move':
      return b.k === 'move' && a.cardId === b.cardId && a.to === b.to;
    case 'confirm':
      return b.k === 'confirm' && (a.pass === true) === (b.pass === true);
    case 'reveal':
      return b.k === 'reveal';
  }
}

function describeStep(steps: HordeLogEntry[], board: PlaytestState | null): string | null {
  const entry = steps[steps.length - 1];
  if (!entry) return null;
  switch (entry.k) {
    case 'reveal':
      return 'the reveal';
    case 'confirm':
      return "the horde's attack";
    case 'take':
      // A passed turn undoes as one step, back to the reveal.
      if (isHordePassTake(steps, steps.length - 1)) return 'nothing attacked';
      return `${entry.dealt} damage taken`;
    case 'damage':
      return `${entry.n} damage to the horde`;
    case 'move': {
      const name = findCardName(board, entry.cardId) ?? 'a card';
      if (entry.to === 'graveyard') return `${name} destroyed`;
      if (entry.to === 'exile') return `${name} exiled`;
      return `${name} returned to the library`;
    }
  }
}

/**
 * The online table's horde controller: replays the table's horde log
 * (`useHordeReplay`) and adds the online-only surface — team-turn state,
 * game-core `HordeActions` dispatch, "start without them", per-seat toasts
 * on the team's moves, and the shared win dispatch. `null` when this device
 * isn't seated at a horde table (mirrors `useOnlineTable`'s own null case).
 *
 * `onlineTable` supplies `dispatch`/`mySeat`; the raw `GameState` (for
 * `.horde`) comes from `useTableSeat` — the one linkage rule, never a fresh
 * `online.players.find`.
 */
export function useOnlineHorde(
  onlineTable: OnlineTable | null,
  rect: Rect | null
): OnlineHordeResult | null {
  const link = useTableSeat();
  const online = link?.online ?? null;
  const table = online?.horde ?? null;
  const mySeat = onlineTable?.mySeat ?? null;
  const dispatch = onlineTable?.dispatch;

  const replayState = useHordeReplay(online, rect);

  const [dismissedDamageStep, setDismissedDamageStep] = useState<number | null>(null);

  const undoLast = useCallback(() => {
    const fresh = usePlayStore.getState().online?.horde;
    if (!fresh || mySeat == null || !dispatch) return;
    dispatch({ type: 'horde-undo', at: fresh.steps.length, actorSeat: mySeat });
  }, [mySeat, dispatch]);

  const markDone = useCallback(
    (done: boolean) => {
      if (mySeat == null || !dispatch) return;
      dispatch({ type: 'horde-done', actorSeat: mySeat, done });
    },
    [mySeat, dispatch]
  );

  const startWithout = useCallback(() => {
    if (mySeat == null || !dispatch) return;
    dispatch({ type: 'horde-done', actorSeat: mySeat, done: true, force: true });
  }, [mySeat, dispatch]);

  const retryReplay = replayState.retry;
  // The log this device's replay read when it found that confirming the
  // reveal leaves nothing to attack with (E1037). Keyed on the steps array
  // itself, not its length, so the confirm carries `pass` only onto that exact
  // log; any other log (even one of the same length) gets a plain confirm.
  const passFor = (replayState.replay?.confirmPasses && table?.steps) || null;
  const actions: HordeActions = useMemo(() => {
    const step = (s: HordeStep) => {
      const fresh = usePlayStore.getState().online?.horde;
      if (!fresh || mySeat == null || !dispatch) return;
      dispatch({ type: 'horde-step', step: s, at: fresh.steps.length, actorSeat: mySeat });
    };
    return {
      take: (amount) => step({ k: 'take', dealt: amount }),
      damage: (amount) => step({ k: 'damage', n: amount }),
      move: (cardId, to) => step({ k: 'move', cardId, to }),
      confirmReveal: () => {
        const steps = usePlayStore.getState().online?.horde?.steps;
        step(steps && steps === passFor ? { k: 'confirm', pass: true } : { k: 'confirm' });
      },
      clearDamageResult: () =>
        setDismissedDamageStep(usePlayStore.getState().online?.horde?.steps.length ?? null),
      retryLoad: () => retryReplay(),
    };
  }, [mySeat, dispatch, retryReplay, passFor]);

  // Edge-triggered side effects on the log growing — never on a re-render or
  // a reload. The cursor is seeded (not fired) the first time this hook sees
  // a table, so a freshly mounted board doesn't replay history as toasts.
  // It holds the log this hook last acted on, not just its length: an
  // optimistic step the server then replaced (a lost race) or took back (an
  // undo) leaves a log that differs from the one seen, at or below its length.
  const seenStepsRef = useRef<HordeLogEntry[] | null>(null);
  // Takes whose board turn this device already advanced but the log no longer
  // holds (an undo, or an optimistic take that lost its race). NEXT_TURN has
  // no inverse (the player may have acted since), so the next take spends the
  // credit instead: one horde turn, one board turn. Counting by length alone,
  // a re-take right after an undo advanced nothing and showed no toast, and
  // one after the log grew past its old length (a damage step, say) advanced
  // the board a second time.
  const turnCreditRef = useRef(0);
  const wonRef = useRef(false);

  useEffect(() => {
    if (!table || !online) return;
    const seen = seenStepsRef.current;
    seenStepsRef.current = table.steps;
    if (seen === null) return;
    const steps = table.steps;
    let common = 0;
    while (common < seen.length && common < steps.length && sameStep(seen[common], steps[common])) {
      common++;
    }
    for (const gone of seen.slice(common)) if (gone.k === 'take') turnCreditRef.current++;

    for (let index = common; index < steps.length; index++) {
      const entry = steps[index];
      if (entry.k !== 'take') continue;
      // Take ends the horde's turn — advance MY OWN board a turn to match,
      // on a live increase only (never on first load, handled by the seed
      // above).
      if (turnCreditRef.current > 0) turnCreditRef.current--;
      else usePlaytestStore.getState().dispatch({ type: 'NEXT_TURN' });
      // A passed turn (nothing attacked) took nothing, and every seat just
      // watched the reveal it came from: no toast, as on the paper table.
      // Only when this device's own replay agrees that confirm (the one just
      // before this take, not the log's latest) left nothing to attack: a
      // wrong pass is announced like any Skip.
      const quiet = replayState.replay?.quietConfirms.includes(index - 1) === true;
      if (isHordePassTake(steps, index) && quiet) continue;
      const seatName = online.players.find((p) => p.seat === entry.seat)?.name ?? 'A teammate';
      const mine = entry.seat === mySeat;
      // Undo only reaches the log's last step, so a take that arrived with
      // later steps behind it (a device catching up) gets no Undo it can't act on.
      const undoable = index === steps.length - 1;
      toast.show({
        message: mine
          ? `You took ${entry.dealt} for the team.`
          : `${seatName} took ${entry.dealt} for the team.`,
        tone: 'info',
        actionLabel: undoable ? 'Undo' : undefined,
        onAction: undoable
          ? () => {
              const fresh = usePlayStore.getState().online?.horde;
              const stillLast =
                fresh &&
                fresh.steps.length === index + 1 &&
                fresh.steps[index]?.ts === entry.ts &&
                fresh.steps[index]?.seat === entry.seat;
              if (stillLast) undoLast();
            }
          : undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed only on the log growing; mySeat/undoLast are read fresh inside, not reasons to re-run
  }, [table, online]);

  // Bosses that entered on the most recent step, announced to teammates who
  // didn't deal the damage themselves (the dealer sees the damage sheet
  // instead). Seeded like the log-growth effect above: the first sighting of
  // an arrival records it without announcing, so a mount/reload doesn't
  // re-announce the table's history.
  const announcedArrivalRef = useRef<number | null>(null);
  const arrivalsSeededRef = useRef(false);

  useEffect(() => {
    const arrivals = replayState.replay?.lastArrivals;
    if (!arrivalsSeededRef.current) {
      arrivalsSeededRef.current = true;
      announcedArrivalRef.current = arrivals?.stepIndex ?? null;
      return;
    }
    if (!arrivals || arrivals.bosses.length === 0 || arrivals.seat === mySeat) return;
    if (announcedArrivalRef.current === arrivals.stepIndex) return;
    announcedArrivalRef.current = arrivals.stepIndex;
    const names = arrivals.bosses.map((b) => b.name).join(', ');
    const verb = arrivals.bosses.length === 1 ? 'joins' : 'join';
    toast.show({
      message: `${bossTickPhrase(arrivals.bosses[0].tick)} ${names} ${verb} the battlefield.`,
    });
  }, [replayState.replay?.lastArrivals, mySeat]);

  // Once the horde is gone, tell the server — a ref guard against a repeat
  // dispatch; the reducer ignores a second `end` on a finished game anyway.
  useEffect(() => {
    if (!online || !dispatch || online.status !== 'active') return;
    if (replayState.replay?.outcome === 'won' && !wonRef.current) {
      wonRef.current = true;
      dispatch({ type: 'end', winnerSeat: null, coopOutcome: 'won' });
    }
  }, [online, dispatch, replayState.replay?.outcome]);

  const lastDamage = replayState.replay?.lastDamage ?? null;
  const damageResult =
    lastDamage && lastDamage.seat === mySeat && lastDamage.stepIndex !== dismissedDamageStep
      ? lastDamage.result
      : null;

  const lastStepLabel = describeStep(table?.steps ?? [], replayState.replay?.view.board ?? null);

  if (!table || !online) return null;

  const activeSurvivors = online.players.filter((p) => !p.eliminated && p.connected);
  const doneSet = new Set(table.done);
  const team: OnlineHordeTeam = {
    phase: table.phase,
    survivorTurn: table.survivorTurn,
    setupTurns: table.settings.setupTurns,
    hordeTurn: table.hordeTurn,
    done: table.done,
    iAmDone: mySeat != null && doneSet.has(mySeat),
    waitingOn: activeSurvivors.filter((p) => !doneSet.has(p.seat)).map((p) => p.name),
    inSetup: table.survivorTurn <= table.settings.setupTurns && table.hordeTurn === 0,
  };

  return {
    status: replayState.status,
    error: replayState.error,
    retry: replayState.retry,
    replay: replayState.replay,
    team,
    actions,
    markDone,
    startWithout,
    undoLast,
    lastStepLabel,
    damageResult,
  };
}
