import { useCallback, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { GAME_PHASES, nextHostSeat } from '@spellcontrol/game-core';
import type { PlaytestAction, PlaytestState } from '@/lib/playtest';
import { haptics } from '@/lib/util/haptics';
import { usePlayStore } from '@/store/play';
import type { OnlineHordeResult } from '../../hooks/use-online-horde';
import type { OnlineTable } from '../../hooks/use-online-table';
import { isHordeTurnDue, type SoloHordeState } from '../../lib/horde-solo';
import { measureHordeRect } from '../../lib/horde-view';
import type { Rect } from '../../lib/auto-place';

interface TurnActionsInput {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  onlineTable: OnlineTable | null;
  onlineHorde: OnlineHordeResult | null;
  horde: SoloHordeState | null;
  hordeFeltRef: RefObject<HTMLDivElement | null>;
  startHordeTurn: (rect?: Rect | null) => void;
  confirm: (options: {
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
}

/**
 * ── Shared board actions ────────────────────────────────────────────────
 * One implementation behind each of the three ways to reach it: the table
 * menu's item, the corner cluster's button, and the key binding. A control
 * that only exists in one of those is how the old bar's actions went
 * unreachable when the bar stopped rendering.
 */
export function useTurnActions({
  state,
  dispatch,
  onlineTable,
  onlineHorde,
  horde,
  hordeFeltRef,
  startHordeTurn,
  confirm,
}: TurnActionsInput) {
  const navigate = useNavigate();
  const activeName = onlineTable?.players.find((p) => p.seat === onlineTable.activeSeat)?.name;
  const myTurn = onlineTable !== null && onlineTable.activeSeat === onlineTable.mySeat;
  const canPassTurn = onlineTable !== null && (myTurn || onlineTable.activeSeat === null);
  // Solo Horde (E387 PR 5): while the horde is mid-turn (its reveal or its
  // attack), the chip is not pressable — same degrade as "somebody else's
  // turn" online.
  const hordeBlocksTurn = horde !== null && (horde.phase === 'reveal' || horde.phase === 'combat');
  /** Is there a turn to move on at all? Always, solo — there is nobody to
   *  wait for. */
  const canAdvanceTurn = (onlineTable === null || canPassTurn) && !hordeBlocksTurn;

  const libraryCount = state.zones.library.length;
  const doDraw = useCallback(() => {
    if (libraryCount === 0) return;
    haptics.tap();
    dispatch({ type: 'DRAW', n: 1 });
  }, [dispatch, libraryCount]);

  const doNextTurn = useCallback(() => dispatch({ type: 'NEXT_TURN' }), [dispatch]);
  // Passing your turn while the horde is due opens its reveal instead of
  // advancing (design decision: "the horde's turn starts when you pass
  // yours"). The turn chip, the Space/next-turn shortcut and the table
  // menu's "Next turn" row all route through this one function, so it is
  // also the one place that refuses while the horde's own turn is running:
  // the chip hid itself then, but Space kept advancing the turn under an
  // unanswered attack banner. False leaves the key to the browser.
  const doNextTurnHordeAware = useCallback(() => {
    if (hordeBlocksTurn) return false;
    if (horde && isHordeTurnDue(horde, state.turn)) {
      startHordeTurn(hordeFeltRef.current ? measureHordeRect(hordeFeltRef.current) : null);
      return true;
    }
    doNextTurn();
    return true;
  }, [hordeBlocksTurn, horde, state.turn, startHordeTurn, doNextTurn, hordeFeltRef]);
  const doUntapAll = useCallback(() => dispatch({ type: 'UNTAP_ALL' }), [dispatch]);
  const doPassTurn = useCallback(() => {
    if (!onlineTable) return;
    haptics.tap();
    onlineTable.dispatch({ type: 'pass-turn', actorSeat: onlineTable.mySeat });
  }, [onlineTable]);
  const doReset = useCallback(async () => {
    const ok = await confirm({
      title: 'Start a new game?',
      body: 'This clears undo history and returns all cards to the starting state.',
      confirmLabel: 'Start a new game',
      danger: true,
    });
    if (ok) dispatch({ type: 'RESET' });
  }, [confirm, dispatch]);
  const concedeOnline = useCallback(async () => {
    if (!onlineTable) return;
    const ok = await confirm({
      title: 'Concede this game?',
      body: 'Your seat is marked out for everyone at the table. The game goes on without you.',
      confirmLabel: 'Concede',
      danger: true,
    });
    if (ok) {
      onlineTable.dispatch({ type: 'eliminate', seat: onlineTable.mySeat, eliminated: true });
    }
  }, [confirm, onlineTable]);
  const leaveOnline = usePlayStore((s) => s.leaveOnline);
  const leaveTable = useCallback(async () => {
    if (!onlineTable) return;
    // A host hands the table on (E430, the server's rule); only a table
    // with nobody left to take it ends for everyone.
    const game = usePlayStore.getState().online;
    const heirSeat = game && onlineTable.isHost ? nextHostSeat(game) : null;
    const heir = heirSeat === null ? null : game?.players.find((p) => p.seat === heirSeat);
    const ok = await confirm({
      title: 'Leave the table?',
      body: !onlineTable.isHost
        ? 'You give up your seat.'
        : heir
          ? `${heir.name} becomes host.`
          : 'Leaving ends the table for everyone still seated.',
      confirmLabel: 'Leave',
      danger: true,
    });
    if (!ok) return;
    await leaveOnline();
    navigate('/play');
  }, [confirm, onlineTable, leaveOnline, navigate]);
  // Life, at the table's own counter when seated online (the local playtest
  // life is a stand-in there — see LifeStrip's online mode).
  const adjustMyLife = useCallback(
    (delta: number) => {
      haptics.tap();
      if (onlineTable) {
        onlineTable.dispatch({
          type: 'life',
          seat: onlineTable.mySeat,
          delta,
          actorSeat: onlineTable.mySeat,
        });
      } else {
        dispatch({ type: 'ADJUST_LIFE', delta });
      }
    },
    [dispatch, onlineTable]
  );
  /**
   * Move the game on: pass the turn at a table, take the next turn solo.
   *
   * One action rather than two, because it is one intent — and because
   * Space was wired to pass-turn ALONE, which made the biggest key on the
   * keyboard do nothing at all in the mode most goldfishing happens in. A
   * key that is dead in the common case is worse than an unbound one: it
   * teaches the player it is broken.
   *
   * Returns false when there is genuinely nothing to do (somebody else's
   * turn at a table), so the keydown handler leaves the key to the browser
   * rather than swallowing it.
   */
  const advanceTurn = useCallback(() => {
    // A horde table has no individual turn to pass — Space (and the chip it
    // drives) toggles this seat's own "done with the team turn" instead.
    if (onlineHorde) {
      onlineHorde.markDone(!onlineHorde.team.iAmDone);
      return true;
    }
    if (onlineTable) {
      if (!canPassTurn) return false;
      doPassTurn();
      return true;
    }
    return doNextTurnHordeAware();
  }, [onlineHorde, onlineTable, canPassTurn, doPassTurn, doNextTurnHordeAware]);

  const advancePhase = useCallback(() => {
    if (!onlineTable) return;
    const cur = onlineTable.phase;
    const next = cur === undefined ? GAME_PHASES[0] : GAME_PHASES[GAME_PHASES.indexOf(cur) + 1];
    if (!next) return;
    onlineTable.dispatch({ type: 'phase', phase: next, actorSeat: onlineTable.mySeat });
  }, [onlineTable]);

  return {
    activeName,
    myTurn,
    canPassTurn,
    hordeBlocksTurn,
    canAdvanceTurn,
    doDraw,
    doNextTurn,
    doNextTurnHordeAware,
    doUntapAll,
    doPassTurn,
    doReset,
    concedeOnline,
    leaveTable,
    adjustMyLife,
    advanceTurn,
    advancePhase,
  };
}
