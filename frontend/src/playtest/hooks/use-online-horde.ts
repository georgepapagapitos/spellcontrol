import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayStore } from '@/store/play';
import { toast } from '@/store/toasts';
import { bossTickPhrase, type HordeDamageResult } from '@/lib/horde';
import type { HordeLogEntry, HordePhase, HordeStep } from '@/lib/game-state';
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

function describeStep(
  entry: HordeLogEntry | undefined,
  board: PlaytestState | null
): string | null {
  if (!entry) return null;
  switch (entry.k) {
    case 'reveal':
      return 'the reveal';
    case 'confirm':
      return "the horde's attack";
    case 'take':
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
      confirmReveal: () => step({ k: 'confirm' }),
      clearDamageResult: () =>
        setDismissedDamageStep(usePlayStore.getState().online?.horde?.steps.length ?? null),
      retryLoad: () => retryReplay(),
    };
  }, [mySeat, dispatch, retryReplay]);

  // Edge-triggered side effects on the log growing — never on a re-render or
  // a reload. The cursor is seeded (not fired) the first time this hook sees
  // a table, so a freshly mounted board doesn't replay history as toasts.
  const seenStepsRef = useRef<number | null>(null);
  const wonRef = useRef(false);

  useEffect(() => {
    if (!table || !online) return;
    const seen = seenStepsRef.current;
    if (seen === null) {
      seenStepsRef.current = table.steps.length;
      return;
    }
    if (table.steps.length <= seen) return;
    const newSteps = table.steps.slice(seen);
    seenStepsRef.current = table.steps.length;

    for (let i = 0; i < newSteps.length; i++) {
      const entry = newSteps[i];
      const index = seen + i;
      if (entry.k !== 'take') continue;
      const seatName = online.players.find((p) => p.seat === entry.seat)?.name ?? 'A teammate';
      const mine = entry.seat === mySeat;
      toast.show({
        message: mine
          ? `You took ${entry.dealt} for the team.`
          : `${seatName} took ${entry.dealt} for the team.`,
        tone: 'info',
        actionLabel: 'Undo',
        onAction: () => {
          const fresh = usePlayStore.getState().online?.horde;
          const stillLast =
            fresh &&
            fresh.steps.length === index + 1 &&
            fresh.steps[index]?.ts === entry.ts &&
            fresh.steps[index]?.seat === entry.seat;
          if (stillLast) undoLast();
        },
      });
      // Take ends the horde's turn — advance MY OWN board a turn to match,
      // on a live increase only (never on first load, handled by the seed
      // above).
      usePlaytestStore.getState().dispatch({ type: 'NEXT_TURN' });
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

  const lastEntry = table?.steps[table.steps.length - 1];
  const lastStepLabel = describeStep(lastEntry, replayState.replay?.view.board ?? null);

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
