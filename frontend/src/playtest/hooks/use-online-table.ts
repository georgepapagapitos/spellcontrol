import { useCallback, useEffect, useMemo } from 'react';
import { usePlayStore } from '@/store/play';
import { turnStartedAt } from '@/lib/game-clock';
import { useAuth } from '@/store/auth';
import { publishBoard } from '@/lib/games-board';
import { toPublicBoard, toPublicTicker, type PublicBoard } from '@/lib/playtest/projection';
import type { PlaytestState } from '@/lib/playtest';
import { capture } from '@/lib/undo-stack';
import { toast } from '@/store/toasts';
import type {
  GameAction,
  GameDesignations,
  GamePhase,
  GamePlayer,
  MulliganType,
} from '@/lib/game-state';
import { usePlaytestStore } from '../store';
import type { OpponentSeat } from '../components/OpponentRail';

export interface OnlineTable {
  /** Seat currently on turn per the online session, if any. */
  activeSeat: number | null;
  /** Every OTHER seated player, ready for `<OpponentRail>`. */
  opponents: OpponentSeat[];
  /** This device's own seat in the active online game — never null when
   *  `OnlineTable` is non-null (that's exactly the condition that produces
   *  one). Consumed by the takeback cross-seat request channel to key
   *  `onlineRequests` (see store/play.ts), which is keyed by requester seat. */
  mySeat: number;
  /** This device's own row in the table's authoritative `GameState` —
   *  `me.life` is the REAL total; the local playtest `state.life` is a
   *  separate (fake, while seated) counter — see LifeStrip's online mode. */
  me: GamePlayer;
  /** Every seated player, in seat order (own seat included). */
  players: GamePlayer[];
  /** Advisory phase clock — absent means the clock hasn't been started. */
  phase: GamePhase | undefined;
  poisonEnabled: boolean;
  commanderDamageEnabled: boolean;
  /** How this table mulligans — the seated board follows the table's setting
   *  instead of this device's own free-mulligan preference, since a mulligan
   *  rule the pod agreed on isn't a per-device taste. */
  mulliganType: MulliganType;
  /** Whether the table shows how long the current turn has run. */
  turnTimerEnabled: boolean;
  /** When the current turn started, for that readout. Resolved here because
   *  it is read off the session's whole event log, which nothing downstream
   *  of this hook holds. Null before the table starts passing turns. */
  turnStartedAt: number | null;
  /** Table-level Monarch/Initiative holders (seat numbers or null) — the
   *  authoritative source LifeStrip badges off in online mode, since a
   *  holder claimed from `/play` must show here too, not just designations
   *  claimed through this device's own DesignationsPicker. */
  designations: GameDesignations;
  /** Mirrors `OnlineGameView`'s `dispatchTracked`: snapshots the pre-action
   *  table state for undo (`capture` no-ops for anything `isUndoable`
   *  doesn't cover, e.g. `phase`/`pass-turn`), then dispatches to the server. */
  dispatch(action: GameAction): void;
}

/** A seated player who hasn't published a board yet this session (just
 *  joined, or hasn't touched their battlefield). `life` is real — the online
 *  session tracks it independently of playtest publishing — but the rest is
 *  deliberately zeroed rather than borrowed from a real board: a fresh
 *  Commander hand is 7 cards and the library is ~90+, so faking `handCount`/
 *  `libraryCount` at 0 would misreport a player who simply hasn't published
 *  yet as already topdecking. `pending: true` on the `OpponentSeat` tells
 *  `OpponentRail` to show a distinct "no board shared yet" state instead. */
function pendingBoard(seat: number, life: number): PublicBoard {
  return {
    seat,
    turn: 0,
    life,
    commanderTax: {},
    monarch: false,
    initiative: false,
    citysBlessing: false,
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [],
    handCount: 0,
    libraryCount: 0,
  };
}

/**
 * The conditional multiplayer seam: playtest and online games are otherwise
 * independent worlds. This hook is the single place that decides whether
 * they're linked for the current render — derived, not a mode toggle: linked
 * exactly when `usePlayStore().online` exists AND this device holds a seat in
 * it (same `userId` match `GameBoard` uses to find "which panel is mine").
 *
 * When linked: publishes `state` (debounced inside `publishBoard`, so this
 * calls it on every change rather than adding a second debounce) and returns
 * the roster for `<OpponentRail>`. When not linked, returns null having done
 * no projection and made no network call — solo playtest pays only the cost
 * of the two lightweight store subscriptions below, which is what makes the
 * link "derived" instead of a route/flag a solo session has to opt out of.
 */
export function useOnlineTable(state: PlaytestState): OnlineTable | null {
  const online = usePlayStore((s) => s.online);
  const onlineBoards = usePlayStore((s) => s.onlineBoards);
  const userId = useAuth((s) => s.user?.id ?? null);

  const mine = useMemo(
    () =>
      online && userId != null ? (online.players.find((p) => p.userId === userId) ?? null) : null,
    [online, userId]
  );
  const code = online?.code ?? null;
  const mySeat = mine?.seat ?? null;

  // Make sure the realtime transport is actually running for this route.
  //
  // Without this the table is WRITE-ONLY here: `publishBoard` below posts
  // directly, so this device's board reaches everyone, but nothing ever
  // subscribes, so no opponent board ever arrives and the rail sits on
  // "No board shared yet" forever. `startPolling()` was only ever called
  // from PlayPage's mount effect and from hostOnline/joinOnline — and
  // PlayPage is NOT mounted on `/decks/:id/playtest`, so a page load
  // straight into playtest (or any reload while seated) started no
  // transport at all. `onlineBoards` is deliberately not persisted, so a
  // reload also drops whatever had already arrived.
  //
  // Safe to call on every change: `startPolling` early-returns when
  // `pollVisibilityHandler` is already set. Deliberately NOT stopped on
  // unmount — leaving playtest doesn't leave the game, and `leaveOnline`
  // already owns teardown.
  useEffect(() => {
    if (code == null || mySeat == null) return;
    usePlayStore.getState().startPolling();
  }, [code, mySeat]);

  // The published board carries the seat's trailing PUBLIC log lines (the
  // play ticker — see toPublicTicker's visibility contract). The same lines
  // feed the local `onlineTicker` too, so this device's own actions appear
  // in the table feed exactly as its opponents see them — one projection,
  // two destinations.
  const gameLog = usePlaytestStore((s) => s.gameLog);
  // Whether this seat has kept its opening hand. Lives in the store's UI
  // phase, not in `PlaytestState`, so `toPublicBoard` can't see it — it gets
  // spread in here alongside the ticker.
  const keptHand = usePlaytestStore((s) => s.phase === 'playing');
  useEffect(() => {
    if (code == null || mySeat == null || !mine) return;
    const ticker = toPublicTicker(gameLog);
    // Override the projection's local `life` with the table's authoritative
    // total for this seat — `toPublicBoard` only knows the local playtest
    // state, which is a second, disconnected life counter while seated (see
    // the OnlineTable.me doc comment).
    publishBoard(code, { ...toPublicBoard(state, mySeat), life: mine.life, ticker, keptHand });
    usePlayStore.getState().ingestTicker(mySeat, ticker);
  }, [code, mySeat, mine, state, gameLog, keptHand]);

  const dispatchOnline = usePlayStore((s) => s.dispatchOnline);
  const dispatch = useCallback(
    (action: GameAction) => {
      if (!online) return;
      capture(online.id, online, action);
      void dispatchOnline(action);
    },
    [online, dispatchOnline]
  );

  // Surface a server-rejected own-seat mutation (403 own-seat, 409 version
  // conflict) the same way OnlineGameView does inline — nothing else renders
  // `onlineError` on the playtest route, so without this a rejected life/
  // cmd-dmg/pass-turn tap here would silently fail. Edge-triggered so a
  // resolved-to-null error never fires a stale toast on mount.
  const onlineError = usePlayStore((s) => s.onlineError);
  useEffect(() => {
    if (mySeat != null && onlineError) toast.show({ message: onlineError, tone: 'error' });
  }, [mySeat, onlineError]);

  return useMemo(() => {
    if (!online || !mine) return null;
    const opponents: OpponentSeat[] = online.players
      .filter((p) => p.seat !== mine.seat)
      .map((p) => {
        const board = onlineBoards[p.seat];
        // Same authoritative-life override as the publish effect above, for
        // every opponent: their rail chip must read the table's real life
        // even if their own device never opens the strip.
        return board
          ? { name: p.name, board: { ...board, life: p.life } }
          : { name: p.name, board: pendingBoard(p.seat, p.life), pending: true };
      });
    const players = [...online.players].sort((a, b) => a.seat - b.seat);
    return {
      activeSeat: online.activeSeat,
      opponents,
      mySeat: mine.seat,
      me: mine,
      players,
      phase: online.phase,
      poisonEnabled: online.poisonEnabled,
      commanderDamageEnabled: online.commanderDamageEnabled,
      mulliganType: online.mulliganType ?? 'commander',
      turnTimerEnabled: online.turnTimerEnabled ?? false,
      turnStartedAt: online.activeSeat == null ? null : turnStartedAt(online),
      designations: online.designations,
      dispatch,
    };
  }, [online, mine, onlineBoards, dispatch]);
}
