import {
  CircleHelp,
  Compass,
  Crown,
  Dices,
  Menu,
  RotateCcw,
  Swords,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { GameAction, GamePlayer, GameState } from '../../lib/game-state';
import { cmdDamageKey } from '../../lib/game-state';
import type { EmptyCell, SeatSlot } from '../../lib/board-layouts';
import {
  isCustomLayout,
  resolveLayout,
  seamSatellite,
  undoButtonParams,
} from '../../lib/board-layouts';
import { paletteForSeat } from '../../lib/seat-palette';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { useFloatingDelta } from '../../lib/use-floating-delta';
import { haptics } from '../../lib/haptics';
import { suppressNativeContextMenu } from '../../lib/suppress-context-menu';
import { useWakeLock } from '../../lib/use-wake-lock';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useFullscreen } from '../../lib/use-fullscreen';
import { capture, clearUndo, peekLabel, popRestore, runSuppressed } from '../../lib/undo-stack';
import { useCardThumb } from '../../lib/card-thumbs';
import { scryfallArtCrop } from '../../lib/offline/slim-to-scryfall';
import { cmdDamageFillRatio, cmdDamageToLethal } from '../../lib/cmd-damage';
import { highRoll as rollHighRoll, type HighRollResult } from '../../lib/game-tools';
import {
  MAX_COUNTERS_PER_SCOPE,
  MAX_COUNTER_NAME_LENGTH,
  normalizeCounterName,
  seatCounters,
} from '../../lib/game-state';
import { usePlayStore } from '../../store/play';
import { HOLD_JUMP } from '../../lib/hold-ramp';
import { useTapAndHold } from '../../lib/tap-and-hold';
import { LifeKeypad } from './LifeKeypad';
import { SeatMenu } from './SeatMenu';
import { ConfirmDialog } from '../ConfirmDialog';
import { hasSeenBoardGestures } from '../../lib/board-gestures-seen';
import { BoardGestureHint } from './BoardGestureHint';
import { BoardHubMenu, type HubPetal } from './BoardHubMenu';
import { GameClock } from './GameClock';
import { GameMenu } from './GameMenu';
import { GameRecap } from './GameRecap';
import './BoardHighRoll.css';

interface Props {
  game: GameState;
  /** Apply an action to the underlying store. */
  dispatch: (action: GameAction) => void;
  /** True when the viewer controls every seat — always true for shared-device local play. */
  canControlAll: boolean;
  /** Hide the board overlay while keeping the game intact (resumable). */
  onMinimize?: () => void;
  /** Destroy the game (local discard). */
  onLeave?: () => void;
  /** Confirm-end-game flow trigger. */
  onEnd?: () => void;
  /** Start a fresh local game with this game's roster + settings. */
  onRematch?: () => void;
}

/**
 * Fullscreen MTG life-counter board for **local (shared-device) pass-and-play
 * only** — online games render their own per-device `OnlineGameView` instead
 * (T99). Each player gets a panel sized to fill the viewport (so a 4-player
 * game = 2×2 grid, 2-player = stacked halves, 3-player = top pair + bottom
 * full-width), and top-row panels rotate 180° so each player reads upright
 * when the phone is passed across the table.
 *
 * Interaction model is touch-first and Lotus-shaped: a seat carries nothing but
 * its number and faint ± hints. Tap the left half of a panel to decrement life,
 * the right half to increment (top/bottom when tapOrientation is vertical); a
 * long press jumps ±10 and repeats. Swipe a seat toward its player to pull its
 * drawer (name, partner, counters, colour, turn, out) down over it like a
 * shade; swipe it away from them for commander damage. Tap the number to type
 * a total.
 *
 * Commander damage is a board-level *focus mode* rather than a per-panel
 * drawer: one player claims focus (swipe away on their own panel, or the
 * drawer's button) and
 * every OTHER panel stops showing its owner's life and starts showing the
 * commander damage that player has dealt to the focused player — same seats,
 * same colors, same positions, so "who is hitting me" is answered by the
 * physical table, not by a list. The focused player's own panel keeps their
 * life total, which ticks down live as they log damage (the `cmd-dmg` reducer
 * subtracts life 1:1), so nothing needs committing on the way out.
 */
export function GameBoard({
  game,
  dispatch,
  canControlAll,
  onMinimize,
  onLeave,
  onEnd,
  onRematch,
}: Props) {
  const total = game.players.length;
  const isShared = game.mode === 'local';
  // Resolve to a concrete layout (grid + per-seat slots). Unknown / legacy
  // layout ids fall back to the count's default.
  const board = resolveLayout(total, game.layout);
  const [menuOpen, setMenuOpen] = useState(false);
  const showClock = usePlayStore((st) => st.showClock);
  // Seats carry no buttons, so a shared board teaches its gestures once per
  // device; the game menu brings the card back.
  const [hintOpen, setHintOpen] = useState(
    () => isShared && canControlAll && game.status !== 'finished' && !hasSeenBoardGestures()
  );
  // Commander-damage focus mode: the seat currently asking "how much has each
  // of you hit me for?". Null = normal board. Held here (not per panel)
  // because entering it changes every OTHER panel's meaning.
  const [cmdFocusSeat, setCmdFocusSeat] = useState<number | null>(null);
  // Resolve against live state so a seat that leaves mid-focus drops the mode
  // instead of stranding the board in a meaningless state.
  const cmdFocus = game.players.find((p) => p.seat === cmdFocusSeat) ?? null;
  // Focus is only enterable from a panel the viewer may edit.
  const cmdFocusCanEdit = cmdFocus != null && canControlAll;
  const exitCmdFocus = useCallback(() => setCmdFocusSeat(null), []);

  // The hub's radial petal ring (Lotus's fan-out): open outside commander-
  // damage mode, closed by the hub itself (now an ✕), Escape, or an outside
  // tap. `hubBtnRef` anchors the ring's fan math and is where focus returns.
  const hubBtnRef = useRef<HTMLButtonElement>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [menuInitialTab, setMenuInitialTab] = useState<'now' | 'setup'>('now');
  // The board-level "High Roll" table moment — a d20 per living seat at once.
  // Held here (not per panel) for the same reason commander-damage focus is:
  // it changes what every panel shows, not just one.
  const [highRollState, setHighRollState] = useState<HighRollResult | null>(null);
  const dismissHighRoll = useCallback(() => setHighRollState(null), []);

  // Offer fullscreen on touch devices the first time this board is tapped —
  // the Fullscreen API needs a genuine gesture, so this can't wait for the
  // player to find the toggle in the menu. Capture phase so it fires ahead of
  // any panel's own onClick calling stopPropagation, and a ref (not state) so
  // it fires at most once per board mount regardless of what else changes.
  // `exitOnUnmount` covers every way off the board (Minimize, Clear the
  // table, finishing and navigating away) with one rule instead of one per
  // exit path — and only fires if THIS request is what caused fullscreen, so
  // it never yanks one the user entered some other way. One hook instance
  // for the whole board (including the menu's manual toggle below, which
  // reads/calls this same instance rather than opening its own) so ownership
  // tracking has a single source of truth.
  const fullscreen = useFullscreen({ exitOnUnmount: true });
  const firstGestureRef = useRef(false);
  const handleFirstGesture = useCallback(() => {
    if (firstGestureRef.current) return;
    firstGestureRef.current = true;
    fullscreen.enter();
  }, [fullscreen]);

  // Keep the screen awake while a game is in progress (real-table use: the
  // phone sits untouched between turns).
  useWakeLock(game.status !== 'finished');

  // Wrap dispatch so undoable actions snapshot the pre-action state first.
  // `game` is the live pre-action state on every render, so capture sees the
  // right baseline. `reset` wipes the stack (the whole game is gone).
  const dispatchTracked = useCallback(
    (action: GameAction) => {
      if (action.type === 'reset') clearUndo(game.id);
      else capture(game.id, game, action);
      dispatch(action);
    },
    [game, dispatch]
  );

  // Undo = compensating actions back to the last snapshot. Suppressed so the
  // restore actions don't themselves get captured. Bumping `undoNonce`
  // signals panels to drop their transient floating-delta chips so the
  // running-burst badge (e.g. "+6") vanishes the instant the burst is undone
  // instead of lingering for its 1.5s lifetime.
  const [undoNonce, setUndoNonce] = useState(0);
  const undoLabel = game.status !== 'finished' ? peekLabel(game.id) : null;
  const onUndo = useCallback(() => {
    const actions = popRestore(game.id, game);
    if (actions.length === 0) return;
    runSuppressed(() => {
      for (const a of actions) dispatch(a);
    });
    setUndoNonce((n) => n + 1);
    haptics.tap();
  }, [game, dispatch]);

  // Keyboard undo (Cmd/Ctrl+Z) — mirrors the undo button; no redo on the play
  // board. Skipped while typing in a text-entry surface, and only fires when
  // undo is actually available (same `undoLabel` gate that renders the button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (!undoLabel) return;
      e.preventDefault();
      onUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUndo, undoLabel]);

  // Esc leaves commander-damage focus mode — the keyboard equivalent of the
  // "Return to game" button and the swipe-back gesture.
  useEffect(() => {
    if (cmdFocusSeat == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      exitCmdFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmdFocusSeat, exitCmdFocus]);

  // High Roll dismisses itself: a few seconds to read the rolls, Escape, or a
  // tap anywhere (each panel's own overlay handles the tap — see PlayerPanel).
  useEffect(() => {
    if (!highRollState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      dismissHighRoll();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(dismissHighRoll, 4000);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [highRollState, dismissHighRoll]);

  // Start a High Roll: one d20 per living seat, then record the winner
  // exactly the way the quiet "First player" menu tool does (same two
  // actions, so both routes feed the same on-the-play stat).
  const startHighRoll = useCallback(() => {
    const result = rollHighRoll(
      game.players.map((p) => ({ seat: p.seat, eliminated: p.eliminated }))
    );
    if (!result) return;
    setHighRollState(result);
    const winner = game.players.find((p) => p.seat === result.winnerSeat);
    dispatchTracked({
      type: 'note',
      actorSeat: null,
      message: `High roll: ${winner?.name ?? `seat ${result.winnerSeat}`} goes first (rolled ${
        result.rolls[result.winnerSeat]
      })`,
    });
    dispatchTracked({ type: 'settings', patch: { startingSeat: result.winnerSeat } });
    dispatchTracked({ type: 'pass-turn', actorSeat: null, toSeat: result.winnerSeat });
    haptics.tap();
  }, [game.players, dispatchTracked]);

  // Lock body scroll while the board is mounted — it's a fullscreen overlay.
  useLockBodyScroll();

  // Seam satellite placement, at both size steps the CSS switches between.
  const undoPlace = seamSatellite(board.seam, board.rows, -1, '3.4rem');
  const undoPlaceLg = seamSatellite(board.seam, board.rows, -1, '4rem');
  const clockPlace = seamSatellite(board.seam, board.rows, 1, '3.4rem');
  const clockPlaceLg = seamSatellite(board.seam, board.rows, 1, '4rem');

  // The hub ring's petals. Restart/Players mirror the game menu's own
  // gating (host-only, meaningless once the game is over); High Roll is a
  // table tool like the menu's coin/dice/first-player, open to any viewer
  // while the game is live. Menu and Help are always reachable.
  const canSetup = canControlAll && game.status !== 'finished';
  const hubPetals: HubPetal[] = [
    ...(canSetup
      ? [
          {
            id: 'restart',
            label: 'Restart',
            icon: <RotateCcw width={16} height={16} strokeWidth={2} aria-hidden />,
            onSelect: () => setRestartConfirmOpen(true),
          },
        ]
      : []),
    ...(game.status !== 'finished'
      ? [
          {
            id: 'high-roll',
            label: 'High roll',
            icon: <Dices width={16} height={16} strokeWidth={2} aria-hidden />,
            onSelect: startHighRoll,
          },
        ]
      : []),
    ...(canSetup
      ? [
          {
            id: 'players',
            label: 'Players',
            icon: <Users width={16} height={16} strokeWidth={2} aria-hidden />,
            onSelect: () => {
              setMenuInitialTab('setup');
              setMenuOpen(true);
            },
          },
        ]
      : []),
    {
      id: 'menu',
      label: 'Menu',
      icon: <Menu width={16} height={16} strokeWidth={2} aria-hidden />,
      onSelect: () => {
        setMenuInitialTab('now');
        setMenuOpen(true);
      },
    },
    {
      id: 'help',
      label: 'Help',
      icon: <CircleHelp width={16} height={16} strokeWidth={2} aria-hidden />,
      onSelect: () => setHintOpen(true),
    },
  ];

  return (
    <div
      className={`game-board game-board-${Math.min(total, 10)} layout-${
        isCustomLayout(board.id) ? 'custom' : board.id
      } mode-${game.mode}${cmdFocus ? ' is-cmd-focus' : ''}`}
      data-shared={isShared || undefined}
      // Right-click belongs to the board, not the browser — same ruling as the
      // playtest table.
      onContextMenu={suppressNativeContextMenu}
      // Capture phase: fires ahead of any panel's own onClick/onPointerDown
      // stopPropagation, and only does anything on the first call (see
      // handleFirstGesture) — a coarse-pointer device gets one fullscreen
      // offer per board mount, not a nag on every tap.
      onPointerDownCapture={handleFirstGesture}
    >
      <div
        className="game-board-grid"
        style={{
          gridTemplateColumns: `repeat(${board.cols}, 1fr)`,
          gridTemplateRows: `repeat(${board.rows}, 1fr)`,
        }}
      >
        {game.players.map((p, i) => {
          const slot = board.seats[i] ?? board.seats[board.seats.length - 1];
          // Resolve legacy states: activeSeat / designations may be absent on
          // old persisted games loaded before UX-324.
          const activeSeat = game.activeSeat ?? null;
          const designations = game.designations ?? { monarch: null, initiative: null };
          return (
            <PlayerPanel
              key={p.id}
              player={p}
              game={game}
              dispatch={dispatchTracked}
              slot={slot}
              // Seat rotation is FIXED: it never changes with board state,
              // including commander-damage focus mode. Re-orienting the board
              // under a mode reads as the seats moving, which is disorienting
              // and looks broken — the panel stays where and how it sits.
              rotation={isShared ? slot.rot : 0}
              canEdit={canControlAll}
              canLayout={canControlAll}
              cmdFocus={cmdFocus}
              cmdFocusCanEdit={cmdFocusCanEdit}
              onCmdFocus={() => setCmdFocusSeat(p.seat)}
              onCmdFocusExit={exitCmdFocus}
              undoNonce={undoNonce}
              onUndo={onUndo}
              undoLabel={undoLabel}
              isActiveTurn={activeSeat === p.seat}
              isMonarch={designations.monarch === p.seat}
              isInitiative={designations.initiative === p.seat}
              highRollValue={highRollState ? (highRollState.rolls[p.seat] ?? null) : null}
              isHighRollWinner={highRollState?.winnerSeat === p.seat}
              highRollActive={highRollState != null}
              onHighRollDismiss={dismissHighRoll}
            />
          );
        })}
        {(board.empty ?? []).map((cell, i) => (
          <EmptyPanel key={`empty-${i}`} cell={cell} />
        ))}
        {/* Floating central hub at the layout's seam — the boundary
          between rotated (far-side) and upright (near-side) seats.
          --seam-top-pct / --seam-left-pct position it precisely;
          row-seam layouts pin top by row index, col-seam layouts pin
          left by column index. Lives INSIDE .game-board-grid so the
          percentages resolve against the seat area, not the whole
          viewport — .game-board's safe-area padding would otherwise
          push the seam off the real row/column boundary. */}
        <button
          type="button"
          ref={hubBtnRef}
          className={`game-board-menu-btn${cmdFocus ? ' is-cmd' : ''}`}
          style={{
            ['--seam-top-pct' as never]:
              'row' in board.seam ? `${(board.seam.row / board.rows) * 100}%` : '50%',
            ['--seam-left-pct' as never]:
              'col' in board.seam ? `${(board.seam.col / board.cols) * 100}%` : '50%',
          }}
          // In commander-damage mode the hub says so (Lotus's dagger) and is
          // the way back out, from the middle of the table where anyone can
          // reach it. Otherwise it opens/closes the radial petal ring — the
          // menu itself is one of the ring's petals now, not a direct tap.
          aria-label={cmdFocus ? 'Return to game' : hubOpen ? 'Close menu' : 'Game menu'}
          aria-haspopup={cmdFocus ? undefined : 'menu'}
          aria-expanded={cmdFocus ? undefined : hubOpen}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (cmdFocus) exitCmdFocus();
            else setHubOpen((v) => !v);
          }}
        >
          {cmdFocus ? (
            <Swords width={22} height={22} strokeWidth={2.2} aria-hidden />
          ) : hubOpen ? (
            <X width={22} height={22} strokeWidth={2.2} aria-hidden />
          ) : (
            <Menu width={22} height={22} strokeWidth={2} aria-hidden />
          )}
        </button>

        {hubOpen && (
          <BoardHubMenu hubRef={hubBtnRef} onClose={() => setHubOpen(false)} petals={hubPetals} />
        )}

        {/* Clock and undo are the seam's two satellites. On a row seam they sit
            either side of the hub, over the gutter. On a column seam the hub is
            a four-corner crossing, so they take the middle of an adjacent
            panel's edge instead — see `seamSatellite`. Hidden in
            commander-damage focus mode (strips the board down to the damage
            question) and while the hub's ring is open (the ring hides them
            rather than risk a petal landing on top of one). */}
        {showClock && !cmdFocus && !hubOpen && (
          <div
            className={`game-board-clock ${'col' in board.seam ? 'is-col-seam' : 'is-row-seam'}`}
            style={{
              ['--seam-top-pct' as never]: clockPlace.topPct,
              ['--seam-left-pct' as never]:
                'col' in board.seam ? `${(board.seam.col / board.cols) * 100}%` : '50%',
              ['--clock-tx' as never]: clockPlace.tx,
              ['--clock-ty' as never]: clockPlace.ty,
              ['--clock-tx-lg' as never]: clockPlaceLg.tx,
              ['--clock-ty-lg' as never]: clockPlaceLg.ty,
            }}
          >
            <GameClock game={game} dispatch={dispatchTracked} canEdit={canControlAll} />
          </div>
        )}

        {undoLabel && !hubOpen && (
          <button
            type="button"
            className="game-board-undo-btn"
            style={{
              ['--seam-top-pct' as never]: undoPlace.topPct,
              ['--seam-left-pct' as never]:
                'col' in board.seam ? `${(board.seam.col / board.cols) * 100}%` : '50%',
              // seamSatellite drives the placement (row-seam = left of the hub,
              // col-seam = a quarter down the seam); undoButtonParams still
              // supplies the icon rotation (0° for row, 90° for col). Two size
              // variants let the CSS media query pick the right offset at ≥600px
              // without recalculating.
              ['--undo-tx' as never]: undoPlace.tx,
              ['--undo-ty' as never]: undoPlace.ty,
              ['--undo-tx-lg' as never]: undoPlaceLg.tx,
              ['--undo-ty-lg' as never]: undoPlaceLg.ty,
              ['--undo-rot' as never]: `${undoButtonParams(board.seam).iconRot}deg`,
            }}
            aria-label={`Undo ${undoLabel}`}
            title={`Undo ${undoLabel}`}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onUndo();
            }}
          >
            <Undo2 width={18} height={18} strokeWidth={2.2} aria-hidden />
          </button>
        )}
      </div>

      {game.status === 'finished' && (
        // Whole-table moment, not per-seat gameplay: screen-relative, never
        // rotated to the winner's seat (B7-01) — everyone at the table reads
        // it the same way, the same as the confetti layer above it.
        <WinCelebration game={game} onDone={onLeave} onRematch={onRematch} />
      )}

      {menuOpen && (
        <GameMenu
          game={game}
          canControlAll={canControlAll}
          onClose={() => setMenuOpen(false)}
          onMinimize={onMinimize}
          onLeave={onLeave}
          onEnd={onEnd}
          onRematch={onRematch}
          onUndo={onUndo}
          undoLabel={undoLabel}
          dispatch={dispatchTracked}
          onShowGestures={() => setHintOpen(true)}
          initialTab={menuInitialTab}
          fullscreenSupported={fullscreen.supported}
          isFullscreen={fullscreen.isFullscreen}
          onToggleFullscreen={fullscreen.toggle}
        />
      )}

      {hintOpen && (
        <BoardGestureHint
          vertical={(game.tapOrientation ?? 'horizontal') === 'vertical'}
          showClock={showClock}
          onClose={() => setHintOpen(false)}
        />
      )}

      {restartConfirmOpen && (
        // Board-level restart, reached from the hub ring: same confirm copy
        // and the same `reset` action as the game menu's own Reset (below the
        // Setup tab) — `dispatchTracked` clears Undo and, for a local game,
        // `dispatchLocal` chains the `start` a local board needs to come back
        // live (store/play.ts) instead of stranding it in `lobby`.
        <ConfirmDialog
          title="Restart the game?"
          body="Every life total, counter and elimination goes back to the start, and Undo can't bring them back."
          confirmLabel="Restart"
          danger
          onCancel={() => setRestartConfirmOpen(false)}
          onConfirm={() => {
            setRestartConfirmOpen(false);
            dispatchTracked({ type: 'reset' });
          }}
        />
      )}
    </div>
  );
}

// ── Player panel ───────────────────────────────────────────────────────────

function PlayerPanel({
  player,
  game,
  dispatch,
  slot,
  rotation,
  canEdit,
  canLayout,
  cmdFocus,
  cmdFocusCanEdit,
  onCmdFocus,
  onCmdFocusExit,
  undoNonce,
  onUndo,
  undoLabel,
  isActiveTurn,
  isMonarch,
  isInitiative,
  highRollValue,
  isHighRollWinner,
  highRollActive,
  onHighRollDismiss,
}: {
  player: GamePlayer;
  game: GameState;
  dispatch: (a: GameAction) => void;
  slot: SeatSlot;
  rotation: number;
  canEdit: boolean;
  /** Viewer may change board geometry (local, or online host). */
  canLayout: boolean;
  /** Player currently logging the commander damage they've received, if any. */
  cmdFocus: GamePlayer | null;
  /** Whether the viewer may edit the focused player's counters. */
  cmdFocusCanEdit: boolean;
  onCmdFocus: () => void;
  onCmdFocusExit: () => void;
  /** Increments on every undo so the panel can drop stale burst chips. */
  undoNonce: number;
  onUndo: () => void;
  undoLabel: string | null;
  /** Whether this seat is the active (current turn) seat. */
  isActiveTurn: boolean;
  /** Designations held by this player. */
  isMonarch: boolean;
  isInitiative: boolean;
  /** This seat's own d20, while a board-level High Roll is showing. */
  highRollValue: number | null;
  isHighRollWinner: boolean;
  /** A High Roll is showing on SOME seat — every panel freezes its taps. */
  highRollActive: boolean;
  onHighRollDismiss: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [lethalFlash, setLethalFlash] = useState(false);
  const [elimBeat, setElimBeat] = useState(false);
  // Initialize to the player's current eliminated state so a restored/resumed
  // game that loads an already-eliminated player doesn't fire the beat on mount.
  const prevEliminatedRef = useRef(player.eliminated);
  // Focus mode splits panels in two: the focused player's own panel keeps
  // showing their life (it drops live as they log damage), and every other
  // panel becomes "commander damage THIS player has dealt to them".
  const isCmdSelf = cmdFocus != null && cmdFocus.seat === player.seat;
  const cmdTarget = cmdFocus != null && !isCmdSelf ? cmdFocus : null;
  /**
   * Rule 903.10a counts to 21 per *commander*, so a Partner seat carries two
   * independent tallies and its panel splits in two. Each is read with the
   * shared `cmdDamageKey` so the board and the reducer can't disagree on which
   * counter a tap belongs to.
   */
  const cmdValue = cmdTarget ? (cmdTarget.commanderDamage[cmdDamageKey(player.seat)] ?? 0) : 0;
  const cmdPartnerValue = cmdTarget
    ? (cmdTarget.commanderDamage[cmdDamageKey(player.seat, true)] ?? 0)
    : 0;
  /** Split only when this seat actually has a second commander. */
  const isCmdSplit = cmdTarget != null && !!player.partner;
  /** This panel's commander, for damage attribution — name is the fallback. */
  const cmdSourceLabel = player.commander ?? player.name;
  /** Every ±1 control reads as life or as commander damage, never ambiguously. */
  const stepLabel = (delta: number, fromPartner = false) =>
    cmdTarget
      ? `${delta > 0 ? '+1' : '-1'} commander damage from ${
          fromPartner ? (player.partner ?? cmdSourceLabel) : cmdSourceLabel
        }`
      : `${delta > 0 ? '+1' : '-1'} life`;
  // Life taps are blocked while any panel overlay is open (seat menu /
  // counters drawer) — otherwise a stray tap on the panel underneath the
  // overlay would change life unexpectedly while the user is picking a
  // color, opening counters, etc.
  // Gates the life tap-zones / step buttons: also off while any overlay
  // (seat menu / counters / keypad) is open so a tap underneath doesn't
  // leak through.
  // In focus mode an opponent panel edits the FOCUSED player's counters, so
  // the gate follows that player (and their eliminated state), not this one's
  // — a dead player's commander can still be the one that killed you, and
  // their panel must stay tickable while you reconstruct the damage.
  const disabled = cmdTarget
    ? !cmdFocusCanEdit || cmdTarget.eliminated || game.status === 'finished'
    : !canEdit ||
      player.eliminated ||
      game.status === 'finished' ||
      drawerOpen ||
      keypadOpen ||
      highRollActive;
  // The drawer's OWN counter +/- controls must stay live while it's open,
  // so they use this narrower gate (no overlay flags).
  const countersDisabled = !canEdit || player.eliminated || game.status === 'finished';

  // Three-tier color resolution:
  //   explicit override → MTG color identity → seat-palette fallback.
  // The seat palette is derived deterministically from the game id so each
  // new game draws a fresh set of vivid colors, stable for that game.
  const colorKey = seatColorKey(player);
  const seatPalette = useMemo(() => paletteForSeat(game.id, player.seat), [game.id, player.seat]);

  // Duration 0 → the big number snaps in the same paint as the delta chip;
  // a tween here made the total visibly trail the tap.
  const { display: animatedLife, popKey } = useAnimatedNumber(
    cmdTarget ? cmdValue : player.life,
    0
  );
  const { chips, push: pushDelta, clear: clearDelta } = useFloatingDelta();
  // An undo just reverted the life — drop the running-burst chip immediately
  // so the "+6" badge doesn't hang around for its normal 1.5s lifetime.
  useEffect(() => {
    clearDelta();
  }, [undoNonce, clearDelta]);
  const panelRef = useRef<HTMLElement | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });

  // Track the most recent pointer location (in panel-local %) so floating
  // delta chips spawn under the user's finger.
  const recordPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = panelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // `rect` is the panel's axis-aligned screen box; CSS rotation isn't
      // reflected in it. Map the hit (as a fraction of that box) back into the
      // panel's own un-rotated coordinate space so the chip lands under the
      // finger on every seat rotation (the default 4p layout uses 90°/270°
      // side seats, not just the 180° top seat). Inverse of a center-origin
      // clockwise CSS rotate. 90/270 swap the box dimensions, which the
      // fraction math absorbs since we work in percentages.
      const sx = ((clientX - rect.left) / rect.width) * 100;
      const sy = ((clientY - rect.top) / rect.height) * 100;
      let x = sx;
      let y = sy;
      if (rotation === 90) {
        x = sy;
        y = 100 - sx;
      } else if (rotation === 180) {
        x = 100 - sx;
        y = 100 - sy;
      } else if (rotation === 270) {
        x = 100 - sy;
        y = sx;
      }
      lastPointerRef.current = { x, y };
    },
    [rotation]
  );

  // Detect "lethal" transitions and flash. Watches life, poison, and
  // commander damage so a poison/cmdr drawer tick also triggers the flash.
  const prevLethalRef = useRef<boolean>(false);
  useEffect(() => {
    const isLethal =
      player.life <= 0 ||
      (game.poisonEnabled && player.poison >= 10) ||
      (game.commanderDamageEnabled && Object.values(player.commanderDamage).some((v) => v >= 21));
    if (isLethal && !prevLethalRef.current && !player.eliminated) {
      setLethalFlash(true);
      haptics.lethal();
      const t = setTimeout(() => setLethalFlash(false), 320);
      prevLethalRef.current = true;
      return () => clearTimeout(t);
    }
    if (!isLethal) prevLethalRef.current = false;
  }, [
    player.life,
    player.poison,
    player.commanderDamage,
    player.eliminated,
    game.poisonEnabled,
    game.commanderDamageEnabled,
  ]);

  // Elimination beat: fires once when the player becomes eliminated.
  useEffect(() => {
    if (player.eliminated && !prevEliminatedRef.current) {
      setElimBeat(true);
      haptics.warning();
      const t = setTimeout(() => setElimBeat(false), 2500);
      prevEliminatedRef.current = player.eliminated;
      return () => clearTimeout(t);
    }
    prevEliminatedRef.current = player.eliminated;
  }, [player.eliminated]);

  const adjust = useCallback(
    (delta: number, skipTap = false, fromPartner = false) => {
      if (disabled) return;
      if (cmdTarget) {
        // Attributed to the focused player as actor: they're the one at the
        // device logging what hit them. `fromPartner` picks which of this
        // seat's two commanders the damage came from.
        dispatch({
          type: 'cmd-dmg',
          seat: cmdTarget.seat,
          fromSeat: player.seat,
          fromPartner,
          delta,
          actorSeat: cmdTarget.seat,
        });
      } else {
        dispatch({ type: 'life', seat: player.seat, delta, actorSeat: player.seat });
      }
      pushDelta(delta, lastPointerRef.current.x, lastPointerRef.current.y);
      if (!skipTap) haptics.tap();
    },
    [disabled, dispatch, player.seat, pushDelta, cmdTarget]
  );

  // The seat's two gestures, both panel-local (`rotation` makes "up" mean
  // away from THAT seat's player). Away: commander damage, the frequent
  // in-game move. Toward: the seat's drawer, which is also the way to revive
  // an eliminated seat, so it opens whatever the seat's state. In focus mode
  // toward is the exact reverse of the swipe that opened it. A swipe cancels
  // the pending life tap/hold inside the hook.
  const canFocusCmd =
    canEdit && !player.eliminated && game.status !== 'finished' && game.commanderDamageEnabled;
  const tapHandlers = useTapAndHold({
    onTap: (delta: number) => adjust(delta),
    onHoldTick: (delta: number, gearUp: boolean) => adjust(delta, gearUp),
    onPointerStart: (e) => recordPointer(e.clientX, e.clientY),
    onPointerMove: (e) => recordPointer(e.clientX, e.clientY),
    onSwipeUp: cmdFocus ? undefined : canFocusCmd ? onCmdFocus : undefined,
    onSwipeDown: cmdFocus ? onCmdFocusExit : canEdit ? () => setDrawerOpen(true) : undefined,
    rotation,
    holdStep: HOLD_JUMP,
    disabled,
  });
  // A second, independent tap/hold instance for the partner half. Hooks can't
  // be called conditionally, so this is always created and simply unused on
  // the single-commander seats that are the overwhelming majority.
  const partnerTapHandlers = useTapAndHold({
    onTap: (delta: number) => adjust(delta, false, true),
    onHoldTick: (delta: number, gearUp: boolean) => adjust(delta, gearUp, true),
    onPointerStart: (e) => recordPointer(e.clientX, e.clientY),
    onPointerMove: (e) => recordPointer(e.clientX, e.clientY),
    onSwipeDown: cmdFocus ? onCmdFocusExit : undefined,
    rotation,
    holdStep: HOLD_JUMP,
    disabled,
  });

  const isSideways = rotation === 90 || rotation === 270;
  // Ambient "danger" pulse when a player is in topdeck range but still alive.
  const isLowLife =
    game.status === 'active' && !player.eliminated && player.life >= 1 && player.life <= 5;
  // Highest commander damage taken from any single opponent — the value
  // that actually matters (lethal at 21 from one commander).
  const cmdDmgValues = Object.values(player.commanderDamage);
  const maxCmdDmg = cmdDmgValues.length > 0 ? Math.max(...cmdDmgValues) : 0;
  const customCounters = Object.entries(seatCounters(player)).filter(([, v]) => v !== 0);
  return (
    <div
      className="player-panel-cell"
      style={{
        gridColumn: slot.colSpan ? `${slot.col} / span ${slot.colSpan}` : `${slot.col}`,
        gridRow: slot.rowSpan ? `${slot.row} / span ${slot.rowSpan}` : `${slot.row}`,
      }}
    >
      <section
        ref={panelRef}
        className={`player-panel ${
          colorKey ? `pp-color-${colorKey}` : `pp-seat pp-ink-${seatPalette.ink}`
        } ${
          player.eliminated ? 'is-eliminated' : ''
        } ${game.winnerSeat === player.seat ? 'is-winner' : ''} ${canEdit ? 'is-mine' : ''} ${
          lethalFlash ? 'is-lethal-flash' : ''
        } ${isLowLife ? 'is-low-life' : ''} ${elimBeat ? 'is-elim-beat' : ''} ${
          isActiveTurn ? 'is-active-turn' : ''
        } ${cmdTarget ? 'is-cmd-source' : ''} ${isCmdSelf ? 'is-cmd-self' : ''} ${
          // Either commander independently reaching 21 is lethal — never the sum.
          cmdTarget && (cmdValue >= 21 || cmdPartnerValue >= 21) ? 'is-cmd-lethal' : ''
        } ${isCmdSplit ? 'is-cmd-split' : ''}`}
        // Rotation is set as a CSS variable consumed by the .player-panel
        // transform rule so it composes cleanly with any other transforms.
        // When no identity / no override applies, the inline palette vars
        // take over as the fallback. Sideways panels (90 / 270) are sized
        // by the CSS to the parent cell's swapped dimensions before rotating
        // (see `.player-panel[data-sideways]`).
        style={{
          ['--pp-rot' as never]: `${rotation}deg`,
          // Progress-to-21, consumed by the .pp-cmd-fill bar. On a split panel
          // each half carries its own --fill instead.
          ...(cmdTarget && !isCmdSplit
            ? { ['--fill' as never]: cmdDamageFillRatio(cmdValue) }
            : {}),
          ...(colorKey
            ? {}
            : {
                ['--pp-base' as never]: seatPalette.base,
                ['--pp-edge' as never]: seatPalette.edge,
                ['--pp-accent' as never]: seatPalette.accent,
              }),
        }}
        data-seat={player.seat}
        data-sideways={isSideways || undefined}
        aria-label={
          isCmdSplit
            ? `${player.name}: commander damage dealt to ${cmdTarget!.name}, ${cmdSourceLabel} ${cmdValue}, ${player.partner} ${cmdPartnerValue}`
            : cmdTarget
              ? `${cmdSourceLabel}: ${cmdValue} commander damage dealt to ${cmdTarget.name}`
              : `${player.name}: ${player.life} life`
        }
      >
        <CommanderArt name={player.commander} />
        {cmdTarget && !isCmdSplit && <div className="pp-cmd-fill" aria-hidden="true" />}
        {/* A split panel owns its zones per half, so the panel-wide ones would
            sit on top of both halves and send every tap to the primary. */}
        {isCmdSplit ? null : (game.tapOrientation ?? 'horizontal') === 'vertical' ? (
          <>
            <div
              className="player-panel-tapzone is-top"
              {...tapHandlers(1)}
              aria-label={stepLabel(1)}
            />
            <div
              className="player-panel-tapzone is-bottom"
              {...tapHandlers(-1)}
              aria-label={stepLabel(-1)}
            />
          </>
        ) : (
          <>
            <div
              className="player-panel-tapzone is-left"
              {...tapHandlers(-1)}
              aria-label={stepLabel(-1)}
            />
            <div
              className="player-panel-tapzone is-right"
              {...tapHandlers(1)}
              aria-label={stepLabel(1)}
            />
          </>
        )}

        <div className="player-panel-content" aria-hidden="false">
          <div className="player-panel-corner is-tl">
            {/* A button (not a label) so a tap on the name opens the drawer
                instead of falling through to the −1 tap zone beneath it. It is
                also the drawer's keyboard and screen-reader route in. */}
            <button
              type="button"
              className="player-panel-name"
              title={player.name}
              aria-label={`${player.name}: seat menu`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setDrawerOpen((v) => !v);
              }}
            >
              {player.isHost && (
                <span className="player-panel-host" aria-label="host">
                  ★
                </span>
              )}
              <span className="player-panel-name-text">{player.name}</span>
              {!player.connected && <span className="player-panel-offline">offline</span>}
            </button>
            {(player.deckName || player.commander) && (
              <div
                className="player-panel-subtitle"
                title={player.commander || player.deckName || undefined}
              >
                {player.commander || player.deckName}
              </div>
            )}
          </div>

          {isCmdSplit ? (
            <div className="pp-cmd-split-wrap">
              <span className="pp-cmd-caption">
                <span aria-hidden="true">⚔</span> dealt to {cmdTarget!.name}
              </span>
              <div className="pp-cmd-split-halves">
                <CmdSplitHalf
                  name={cmdSourceLabel}
                  value={cmdValue}
                  disabled={disabled}
                  handlers={tapHandlers}
                  stepLabel={(d) => stepLabel(d, false)}
                  onStep={(d) => adjust(d, false, false)}
                />
                <CmdSplitHalf
                  name={player.partner!}
                  value={cmdPartnerValue}
                  disabled={disabled}
                  handlers={partnerTapHandlers}
                  stepLabel={(d) => stepLabel(d, true)}
                  onStep={(d) => adjust(d, false, true)}
                />
              </div>
            </div>
          ) : (
            <div className="player-panel-life-wrap">
              {cmdTarget && (
                <span className="pp-cmd-caption">
                  <span aria-hidden="true">⚔</span> dealt to {cmdTarget.name}
                </span>
              )}
              <button
                type="button"
                className="player-panel-step-btn"
                aria-label={stepLabel(-1)}
                disabled={disabled}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  adjust(-1);
                }}
              >
                <span className="player-panel-step-glyph">−</span>
                {chips.length > 0 && chips[chips.length - 1].value < 0 && (
                  <span className="player-panel-step-count">
                    {Math.abs(chips[chips.length - 1].value)}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="player-panel-life player-panel-life-btn"
                data-digits={String(animatedLife).length}
                aria-label={
                  cmdTarget
                    ? `${cmdValue} commander damage from ${cmdSourceLabel}`
                    : `Set life: currently ${player.life}`
                }
                aria-live="polite"
                // No set-by-keypad for commander damage: the number isn't this
                // panel's to set, and the keypad would edit the wrong player.
                disabled={cmdTarget != null || !canEdit || game.status === 'finished'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (cmdTarget || !canEdit || game.status === 'finished') return;
                  setKeypadOpen(true);
                }}
              >
                <span key={popKey} className="player-panel-life-num is-pop">
                  {animatedLife}
                </span>
              </button>
              {cmdTarget && cmdDamageToLethal(cmdValue) !== null && (
                // The value itself is aria-live above, so this derived read is a
                // sighted-only convenience — hidden so it isn't announced twice.
                <span className="pp-cmd-hint" aria-hidden="true">
                  {cmdDamageToLethal(cmdValue)} to lethal
                </span>
              )}
              <button
                type="button"
                className="player-panel-step-btn"
                aria-label={stepLabel(1)}
                disabled={disabled}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  adjust(1);
                }}
              >
                <span className="player-panel-step-glyph">+</span>
                {chips.length > 0 && chips[chips.length - 1].value > 0 && (
                  <span className="player-panel-step-count">{chips[chips.length - 1].value}</span>
                )}
              </button>
            </div>
          )}

          {/* Focus mode: this panel's own life is no longer the headline, so
              keep it as a small readout — you shouldn't lose the board state
              just because you're logging damage. */}
          {cmdTarget && (
            <div className="player-panel-counters">
              <span className="pp-life-chip">{player.life} life</span>
            </div>
          )}

          {/* What this seat is carrying, read-only: the board shows state and
              the drawer changes it. Only non-zero counts appear, so a fresh
              seat is just its number. */}
          {!cmdFocus &&
            ((game.poisonEnabled && player.poison > 0) ||
              maxCmdDmg > 0 ||
              customCounters.length > 0) && (
              <div className="player-panel-counters">
                {game.poisonEnabled && player.poison > 0 && (
                  <span
                    className={`pp-counter-badge ${player.poison >= 10 ? 'is-lethal' : ''}`}
                    role="img"
                    aria-label={`Poison ${player.poison}`}
                  >
                    ☠ {player.poison}
                  </span>
                )}
                {maxCmdDmg > 0 && (
                  <span
                    className={`pp-counter-badge ${maxCmdDmg >= 21 ? 'is-lethal' : ''}`}
                    role="img"
                    aria-label={`Commander damage, highest ${maxCmdDmg}`}
                  >
                    ⚔ {maxCmdDmg}
                  </span>
                )}
                {customCounters.map(([name, value]) => (
                  <span key={name} className="pp-counter-badge is-custom">
                    <span className="pp-counter-badge-name">{name}</span>
                    {value}
                  </span>
                ))}
              </div>
            )}

          {/* Designations read on the seat that holds them, rotated to face
              that player. Marks only: the drawer is where they change hands. */}
          {(isMonarch || isInitiative) && (
            <div className="pp-designation-chips">
              {isMonarch && (
                <span className="pp-designation-chip is-monarch" role="img" aria-label="Monarch">
                  <Crown width={14} height={14} aria-hidden />
                </span>
              )}
              {isInitiative && (
                <span
                  className="pp-designation-chip is-initiative"
                  role="img"
                  aria-label="Initiative"
                >
                  <Compass width={14} height={14} aria-hidden />
                </span>
              )}
            </div>
          )}
        </div>

        {elimBeat && undoLabel && (
          <button
            type="button"
            className="pp-elim-undo-btn"
            aria-label={`Undo ${undoLabel}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onUndo();
            }}
          >
            <Undo2 width={16} height={16} strokeWidth={2.2} aria-hidden />
            Undo
          </button>
        )}

        {/* High Roll: covers the whole panel (so a dismiss-tap can't leak
            through to a life change underneath it — same trick the drawer and
            keypad covers already rely on) and renders inside the rotated
            section, so it reads upright for whoever sits at this seat.
            role="presentation" + dismiss-only-on-self mirrors the win
            celebration's own backdrop, the established pattern for a
            non-interactive full-panel dismiss surface. */}
        {highRollValue != null && (
          <div
            className={`pp-highroll ${isHighRollWinner ? 'is-winner' : 'is-dim'}`}
            role="presentation"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) onHighRollDismiss();
            }}
          >
            <span className="pp-highroll-die" aria-hidden="true">
              <Dices width={28} height={28} strokeWidth={2} />
            </span>
            <span className="pp-highroll-value" aria-live="polite">
              {highRollValue}
            </span>
            {isHighRollWinner && <span className="pp-highroll-caption">goes first</span>}
          </div>
        )}

        {/* The focused player's own panel carries the mode's title and the
            explicit way out — it's already rotated to face them, and it's
            where they're looking while their life ticks down. */}
        {isCmdSelf && (
          <div className="pp-cmd-focus-bar">
            <span className="pp-cmd-focus-title">Commander damage you've received</span>
            <button
              type="button"
              className="pp-cmd-focus-done"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onCmdFocusExit();
              }}
            >
              Return to game
            </button>
          </div>
        )}

        {drawerOpen && (
          <SeatMenu
            player={player}
            game={game}
            canEdit={canEdit}
            canLayout={canLayout}
            rotation={rotation}
            dispatch={dispatch}
            onClose={() => setDrawerOpen(false)}
            onCommanderDamage={canFocusCmd ? onCmdFocus : undefined}
            isActiveTurn={isActiveTurn}
            isMonarch={isMonarch}
            isInitiative={isInitiative}
          >
            <SeatCounters
              player={player}
              game={game}
              disabled={countersDisabled}
              dispatch={dispatch}
            />
          </SeatMenu>
        )}

        {game.winnerSeat === player.seat && <div className="player-panel-winner-tag">Winner</div>}
        {player.eliminated && game.winnerSeat !== player.seat && (
          <div className="player-panel-eliminated-tag">Out</div>
        )}

        {keypadOpen && (
          <LifeKeypad
            playerName={player.name}
            currentLife={player.life}
            onConfirm={(value) => {
              dispatch({
                type: 'set-life',
                seat: player.seat,
                value,
                actorSeat: player.seat,
              });
              setKeypadOpen(false);
            }}
            onClose={() => setKeypadOpen(false)}
          />
        )}
      </section>
    </div>
  );
}

// ── Commander art backdrop ─────────────────────────────────────────────────

/**
 * Faint commander art crop rendered as the bottom-most layer of a player
 * panel, under the flat color-identity fill. Isolated into its own memoized
 * component so its load-triggered state change (the one-time fade-in) never
 * forces the parent `PlayerPanel` — and its per-frame life-counter state —
 * to re-render. `React.memo` on a `name`-only prop also means this never
 * re-renders on a life tap: `name` doesn't change when life does.
 *
 * `useCardThumb` already no-ops for an undefined name (guest seat / no
 * commander), so those seats render nothing here — identical to today. The
 * offline slim bundle carries only the `normal` image, not `art_crop`
 * (#843); `scryfallArtCrop` is the established normal→art_crop URL
 * derivation (a CDN path-segment swap), reused here rather than re-derived.
 */
const CommanderArt = memo(function CommanderArt({ name }: { name: string | null | undefined }) {
  const thumb = useCardThumb(name ?? undefined, 'normal');
  const art = thumb ? scryfallArtCrop(thumb) : undefined;
  const [loaded, setLoaded] = useState(false);
  if (!art) return null;
  return (
    <img
      key={art}
      className={`player-panel-art${loaded ? ' is-loaded' : ''}`}
      src={art}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
    />
  );
});

// ── Seat counters (inside the seat drawer) ─────────────────────────────────

/**
 * The seat's counters: poison, plus whatever this table tracks by name. A
 * section of the seat drawer (see `SeatMenu`), which is why it has no cover,
 * heading bar or close of its own.
 *
 * Commander damage is NOT here — it's the board-level focus mode (see
 * `PlayerPanel`), which puts each opponent's damage on that opponent's own
 * seat instead of in a list.
 */
function SeatCounters({
  player,
  game,
  disabled,
  dispatch,
}: {
  player: GamePlayer;
  game: GameState;
  disabled: boolean;
  dispatch: (a: GameAction) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const headingId = useId();
  const counters = Object.entries(seatCounters(player));
  const atCap = counters.length >= MAX_COUNTERS_PER_SCOPE;
  return (
    <section className="pp-counters" aria-labelledby={headingId}>
      <span id={headingId} className="seat-menu-label">
        Counters
      </span>
      <div className="pp-counters-inner">
        <div className="pp-counters-body">
          {game.poisonEnabled && (
            <CounterRow
              label="☠ Poison"
              value={player.poison}
              disabled={disabled}
              lethal={player.poison >= 10}
              onChange={(d) =>
                dispatch({ type: 'poison', seat: player.seat, delta: d, actorSeat: player.seat })
              }
            />
          )}
          {counters.map(([name, value]) => (
            <CounterRow
              key={name}
              label={name}
              value={value}
              disabled={disabled}
              lethal={false}
              onChange={(d) =>
                dispatch({
                  type: 'counter',
                  seat: player.seat,
                  name,
                  delta: d,
                  actorSeat: player.seat,
                })
              }
              onRemove={
                disabled
                  ? undefined
                  : () =>
                      dispatch({
                        type: 'counter-remove',
                        seat: player.seat,
                        name,
                        actorSeat: player.seat,
                      })
              }
            />
          ))}
          {!game.poisonEnabled && counters.length === 0 && (
            <p className="pp-counters-empty">
              Nothing tracked yet. Add whatever this table counts.
            </p>
          )}
        </div>
        {!disabled &&
          (atCap ? (
            <p className="pp-counters-cap" role="status">
              {MAX_COUNTERS_PER_SCOPE} counters is the limit. Remove one to add another.
            </p>
          ) : (
            <form
              className="pp-counters-add"
              onSubmit={(e) => {
                e.preventDefault();
                let name: string;
                try {
                  name = normalizeCounterName(draft);
                } catch {
                  setError('Give the counter a name.');
                  return;
                }
                if (name in seatCounters(player)) {
                  setError(`${name} is already here.`);
                  return;
                }
                // Delta 0 creates it at zero — the reducer has no separate
                // "add" action precisely so this stays one dispatch.
                dispatch({
                  type: 'counter',
                  seat: player.seat,
                  name,
                  delta: 0,
                  actorSeat: player.seat,
                });
                setDraft('');
                setError(null);
              }}
            >
              <label className="pp-counters-add-field">
                <span className="visually-hidden">New counter name</span>
                <input
                  className="pp-counters-add-input"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setError(null);
                  }}
                  maxLength={MAX_COUNTER_NAME_LENGTH}
                  placeholder="Energy"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                />
              </label>
              <button type="submit" className="pp-counters-add-btn">
                Add
              </button>
            </form>
          ))}
        {error && (
          <p id={errorId} className="pp-counters-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * One commander's damage counter inside a split (Partner) panel. Each half is
 * self-contained — its own name, number, ± zones and progress-to-21 fill —
 * because rule 903.10a counts to 21 per commander, so the two must never look
 * like halves of one total that could be added together.
 */
function CmdSplitHalf({
  name,
  value,
  disabled,
  handlers,
  stepLabel,
  onStep,
}: {
  name: string;
  value: number;
  disabled: boolean;
  /** A tap-and-hold factory bound to THIS commander (primary or partner). */
  handlers: (arg: number) => Record<string, unknown>;
  stepLabel: (delta: number) => string;
  onStep: (delta: number) => void;
}) {
  const toLethal = cmdDamageToLethal(value);
  return (
    <div
      className={`pp-cmd-half ${value >= 21 ? 'is-lethal' : ''}`}
      style={{ ['--fill' as never]: cmdDamageFillRatio(value) }}
    >
      <div className="pp-cmd-half-fill" aria-hidden="true" />
      {/* Own zones, not the panel's: a panel-wide zone would swallow both
          halves and send every tap to the primary commander. */}
      <div className="pp-cmd-half-zone is-minus" {...handlers(-1)} aria-label={stepLabel(-1)} />
      <div className="pp-cmd-half-zone is-plus" {...handlers(1)} aria-label={stepLabel(1)} />
      <span className="pp-cmd-half-name" title={name}>
        {name}
      </span>
      <div className="pp-cmd-half-row">
        <button
          type="button"
          className="pp-cmd-half-step"
          aria-label={stepLabel(-1)}
          disabled={disabled}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onStep(-1);
          }}
        >
          −
        </button>
        <span className="pp-cmd-half-value" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="pp-cmd-half-step"
          aria-label={stepLabel(1)}
          disabled={disabled}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onStep(1);
          }}
        >
          +
        </button>
      </div>
      {toLethal !== null && (
        // The value is aria-live above; this derived read is sighted-only so
        // it isn't announced twice per tap.
        <span className="pp-cmd-half-hint" aria-hidden="true">
          {toLethal} to lethal
        </span>
      )}
    </div>
  );
}

function CounterRow({
  label,
  value,
  disabled,
  lethal,
  onChange,
  onRemove,
}: {
  label: string;
  value: number;
  disabled: boolean;
  lethal: boolean;
  onChange: (delta: number) => void;
  /** Free-form counters can be deleted; poison is a rule and cannot. */
  onRemove?: () => void;
}) {
  const tapHandlers = useTapAndHold({
    onTap: onChange,
    onHoldTick: (delta) => onChange(delta),
    disabled,
  });
  return (
    <div className={`counter-row ${lethal ? 'is-lethal' : ''}`}>
      <span className="counter-row-label">{label}</span>
      <div className="counter-row-controls">
        <button
          type="button"
          className="counter-row-btn"
          aria-label={`-1 ${label}`}
          disabled={disabled}
          {...tapHandlers(-1)}
        >
          −
        </button>
        <span className="counter-row-value">{value}</span>
        <button
          type="button"
          className="counter-row-btn"
          aria-label={`+1 ${label}`}
          disabled={disabled}
          {...tapHandlers(1)}
        >
          +
        </button>
        {onRemove && (
          <button
            type="button"
            className="counter-row-remove"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            <Trash2 width={14} height={14} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Facing arrow (shared by SeatMenu + LayoutEditor) ───────────────────────

// ── Color identity → CSS modifier ───────────────────────────────────────────

/**
 * Map a Magic color identity array to a panel theme key. Mono colors get
 * their letter, multi-color decks get 'm' (gold), and no/empty identity is
 * 'c' (colorless gray).
 */
function identityKey(ci: string[]): string {
  if (!ci || ci.length === 0) return 'c';
  if (ci.length === 1) return ci[0].toLowerCase();
  return 'm';
}

/**
 * Two-tier panel color key: explicit override → MTG color identity. Null means
 * neither applies and the caller should fall back to `paletteForSeat`. Shared
 * by the seat panel and the commander-damage tiles so an opponent's tile is
 * tinted exactly like that opponent's own panel.
 */
function seatColorKey(p: GamePlayer): string | null {
  if (p.panelColorKey) return p.panelColorKey.toLowerCase();
  return Array.isArray(p.colorIdentity) && p.colorIdentity.length > 0
    ? identityKey(p.colorIdentity)
    : null;
}

// ── Win celebration ────────────────────────────────────────────────────────

const CONFETTI_COUNT = 28;

/**
 * Full-board finished-game moment: a confetti burst plus the winner's name in
 * their own seat color, or (for a draw) a plain "no winner" notice — either
 * way followed by the game's recap. Dismissable (the game menu / history are
 * still reachable underneath). Resets when a new game finishes because the
 * parent only mounts it while `status === 'finished'`, and the keyed remount
 * on game id clears the dismissed state.
 */
/**
 * Per-game "already dismissed" memory for the win overlay. Component state
 * alone replayed the confetti + recap on every remount — every return to
 * /play, every tab switch back to Local — for as long as the finished game
 * stayed on the table. sessionStorage is the right scope: it survives
 * remounts and reloads within the tab and needs no cleanup (a stale key for a
 * discarded game id is never read again).
 */
const CELEBRATION_SEEN_PREFIX = 'spellcontrol:win-celebration-seen:';
function celebrationSeen(gameId: string): boolean {
  try {
    return sessionStorage.getItem(CELEBRATION_SEEN_PREFIX + gameId) === '1';
  } catch {
    return false;
  }
}
function markCelebrationSeen(gameId: string): void {
  try {
    sessionStorage.setItem(CELEBRATION_SEEN_PREFIX + gameId, '1');
  } catch {
    /* private mode / quota — the in-memory flag still covers this mount */
  }
}

function WinCelebration({
  game,
  onDone,
  onRematch,
}: {
  game: GameState;
  /** Leave the finished table (clear it locally / leave it online). */
  onDone?: () => void;
  onRematch?: () => void;
}) {
  const [dismissed, setDismissedState] = useState(() => celebrationSeen(game.id));
  const setDismissed = (next: boolean) => {
    if (next) markCelebrationSeen(game.id);
    setDismissedState(next);
  };
  const isDraw = game.winnerSeat == null;
  const winner = isDraw ? undefined : game.players.find((p) => p.seat === game.winnerSeat);
  const palette = useMemo(
    () => (game.winnerSeat != null ? paletteForSeat(game.id, game.winnerSeat) : null),
    [game.id, game.winnerSeat]
  );
  // Stable per-mount confetti so it doesn't reshuffle on every re-render.
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        left: (i / CONFETTI_COUNT) * 100 + (i % 3) * 4,
        delay: (i % 7) * 0.12,
        duration: 2.4 + (i % 5) * 0.35,
        hue: (i * 47) % 360,
        rot: (i % 2 ? 1 : -1) * (120 + (i % 4) * 60),
      })),
    []
  );

  // A non-draw game with no matching player is a data-integrity edge case
  // (e.g. the winning seat left) — same as before, just skip the overlay.
  if (dismissed || (!isDraw && !winner)) return null;
  return (
    <div
      className="win-celebration"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) setDismissed(true);
      }}
    >
      {winner && (
        <div className="win-celebration-confetti" aria-hidden="true">
          {pieces.map((p, i) => (
            <span
              key={i}
              className="win-confetti-piece"
              style={{
                left: `${p.left}%`,
                background: `hsl(${p.hue} 85% 60%)`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                ['--confetti-rot' as never]: `${p.rot}deg`,
              }}
            />
          ))}
        </div>
      )}
      <div
        className="win-celebration-card"
        role="dialog"
        aria-modal="true"
        aria-label={winner ? `${winner.name} wins` : 'Game over. No winner.'}
        style={palette ? { ['--win-accent' as never]: palette.edge } : undefined}
      >
        {winner ? (
          <>
            <span className="win-celebration-trophy" aria-hidden="true">
              🏆
            </span>
            <span className="win-celebration-name">{winner.name}</span>
            <span className="win-celebration-sub">wins the game</span>
          </>
        ) : (
          <span className="win-celebration-sub">Game over. No winner.</span>
        )}
        <GameRecap game={game} />
        {/* The recap is the end of the session: Done leaves the table (the
            result is already in History), Rematch re-seats everyone. Tapping
            outside still just dismisses, for anyone who wants to keep looking
            at the final board. */}
        <div className="win-celebration-actions">
          {onRematch && (
            <button
              type="button"
              className="win-celebration-dismiss"
              onClick={() => {
                setDismissed(true);
                onRematch();
              }}
            >
              Rematch
            </button>
          )}
          <button
            type="button"
            className="win-celebration-dismiss is-primary"
            onClick={() => {
              setDismissed(true);
              onDone?.();
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders an explicitly-empty grid cell — a faded placeholder that
 * matches the panel shape but reads as "no player here." The global
 * game-menu hub is rendered separately at the layout's row seam.
 */
function EmptyPanel({ cell }: { cell: EmptyCell }) {
  const style: React.CSSProperties = {
    gridColumn: cell.colSpan ? `${cell.col} / span ${cell.colSpan}` : `${cell.col}`,
    gridRow: cell.rowSpan ? `${cell.row} / span ${cell.rowSpan}` : `${cell.row}`,
  };
  return <div className="player-panel is-empty" style={style} aria-hidden="true" />;
}
