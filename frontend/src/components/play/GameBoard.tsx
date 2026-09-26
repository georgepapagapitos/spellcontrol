import {
  ChevronRight,
  CircleHelp,
  Compass,
  Crown,
  Dices,
  Menu,
  RotateCcw,
  Swords,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameAction, GamePlayer, GameState } from '../../lib/game-state';
import { cmdDamageKey, nextActiveSeat } from '../../lib/game-state';
import type { EmptyCell, SeatSlot } from '../../lib/board-layouts';
import {
  isCustomLayout,
  resolveLayout,
  seamSatellite,
  turnOrderOf,
  undoButtonParams,
} from '../../lib/board-layouts';
import { paletteForSeat } from '../../lib/seat-palette';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { useFloatingDelta } from '../../lib/use-floating-delta';
import { haptics } from '../../lib/haptics';
import { suppressNativeContextMenu } from '../../lib/suppress-context-menu';
import { useWakeLock } from '../../lib/use-wake-lock';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useBackgroundInert } from '../../lib/use-background-inert';
import { useFullscreen } from '../../lib/use-fullscreen';
import { useBoardKeepStill } from '../../lib/use-board-keep-still';
import { capture, clearUndo, peekLabel, popRestore, runSuppressed } from '../../lib/undo-stack';
import { useCardThumb } from '../../lib/card-thumbs';
import { scryfallArtCrop } from '../../lib/offline/slim-to-scryfall';
import { cmdDamageFillRatio, cmdDamageToLethal } from '../../lib/cmd-damage';
import { highRoll as rollHighRoll, type HighRollResult } from '../../lib/game-tools';
import { seatCounters } from '../../lib/game-state';
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
  const board = resolveLayout(total, game.layout, turnOrderOf(game));
  const [menuOpen, setMenuOpen] = useState(false);
  const gameTimerEnabled = usePlayStore((st) => st.gameTimerEnabled);
  const turnTrackerEnabled = usePlayStore((st) => st.turnTrackerEnabled);
  const showClockStrip = gameTimerEnabled || turnTrackerEnabled;
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

  // The life keypad is a board-level overlay (Lotus's model), not a per-panel
  // cover — held here for the same reason cmdFocus is: it needs to dim and
  // sit above the WHOLE board, not just the seat that opened it. Resolving
  // against live state (like cmdFocus) means a seat that leaves mid-edit
  // just closes the keypad instead of stranding it on a gone player.
  const [keypadSeat, setKeypadSeat] = useState<number | null>(null);
  const keypadIndex = game.players.findIndex((p) => p.seat === keypadSeat);
  const keypadPlayer = keypadIndex >= 0 ? game.players[keypadIndex] : null;
  const keypadSlot =
    keypadIndex >= 0 ? (board.seats[keypadIndex] ?? board.seats[board.seats.length - 1]) : null;
  const keypadRotation = isShared ? (keypadSlot?.rot ?? 0) : 0;
  const closeKeypad = useCallback(() => setKeypadSeat(null), []);

  // The hub's radial petal ring (Lotus's fan-out): open outside commander-
  // damage mode, closed by the hub itself (now an ✕), Escape, or an outside
  // tap. `hubBtnRef` anchors the ring's fan math and is where focus returns.
  const hubBtnRef = useRef<HTMLButtonElement>(null);
  const [hubOpen, setHubOpen] = useState(false);
  // How the ring's current open was triggered — a real pointer click's
  // synthesized `MouseEvent.detail` is >=1, a keyboard (Enter/Space)
  // activation's is 0. Keyboard opening should focus the first petal with a
  // visible ring (WAI-ARIA menu behaviour); a pointer open shouldn't draw one
  // (a tap on the hub is not "selecting" Restart) — see BoardHubMenu. State,
  // not a ref: BoardHubMenu reads this during render.
  const [hubOpenedByKeyboard, setHubOpenedByKeyboard] = useState(true);
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

  // "Keep the board still": a phone lying flat that auto-rotates into
  // landscape must not spin the seats. 0 outside that case (portrait, or a
  // landscape window/tablet tall enough not to trigger it) — every panel's
  // OWN visual rotation (slot.rot, below) is untouched either way, since it
  // composes with this automatically through normal CSS transform nesting
  // once `.game-board-rotator` carries the counter-rotation. Only code that
  // reads raw screen-space pointer coordinates (tap zones, swipes, the hub
  // ring's petal math) needs this value explicitly — see the STYLE_GUIDE
  // ruling and `lib/use-board-keep-still.ts`.
  const boardRotation = useBoardKeepStill();

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
    const winnerRolls = result.rolls[result.winnerSeat];
    const rolledText =
      winnerRolls.length > 1
        ? `rolled ${winnerRolls[0]}, then ${winnerRolls.slice(1).join(', then ')}`
        : `rolled ${winnerRolls[0]}`;
    dispatchTracked({
      type: 'note',
      actorSeat: null,
      message: `High roll: ${winner?.name ?? `seat ${result.winnerSeat}`} goes first (${rolledText})`,
    });
    dispatchTracked({ type: 'settings', patch: { startingSeat: result.winnerSeat } });
    dispatchTracked({ type: 'pass-turn', actorSeat: null, toSeat: result.winnerSeat });
    haptics.tap();
  }, [game.players, dispatchTracked]);

  // Lock body scroll while the board is mounted — it's a fullscreen overlay.
  useLockBodyScroll();

  // F10: hold focus like a modal. The board covers the screen but isn't
  // portaled, so without this Tab walks past its last control into the
  // Header's nav links and the Play page's own tabs underneath it.
  const boardRootRef = useRef<HTMLDivElement>(null);
  useBackgroundInert(true, boardRootRef);

  // Seam satellite placement, at both size steps the CSS switches between.
  // The clock used to be the seam's other satellite; it's an edge strip now
  // (see the render below), so undo is the only satellite left.
  // `wideFirstRow`: derived from the layout's own data (never a preset id) —
  // seamSatellite only shifts the column-seam quarter point off 25% for a
  // board whose row 1 has no left/right split at all, and only when that
  // shape's row count would otherwise land the flat quarter inside a cell
  // rather than on its boundary. See that function's own doc comment.
  const wideFirstRow = board.seats[0]?.colSpan === 2;
  const undoPlace = seamSatellite(board.seam, board.rows, -1, '3.4rem', wideFirstRow);
  const undoPlaceLg = seamSatellite(board.seam, board.rows, -1, '4rem', wideFirstRow);
  // Read-only "up next" marker: the seat `pass-turn` would move to right now.
  // Null (no marker anywhere) with the turn tracker off, before turn tracking
  // starts, or once only one seat survives — "next" means nothing when
  // there's no one else to pass to.
  const nextSeat =
    turnTrackerEnabled && game.status === 'active' && game.activeSeat != null
      ? nextActiveSeat(game.players, game.activeSeat)
      : null;

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
      ref={boardRootRef}
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
      {/* Everything a table-mate reads gets counter-rotated together as one
          rigid unit when a phone auto-rotates into landscape lying flat —
          "keep the board still" (STYLE_GUIDE). `data-board-rot` is unset in
          the common case (portrait, or a window tall enough not to trigger
          it), so this is a plain passthrough wrapper then. ConfirmDialog is
          the one overlay NOT inside it: it renders through the shared
          `Modal` portal to `document.body`, outside this subtree entirely —
          see the STYLE_GUIDE ruling on why that one dialog stays screen-
          relative instead of threading rotation through app-wide Modal.
          The board-level life keypad IS inside it (below, alongside the
          other overlays) so it rotates with the board in landscape too. */}
      <div className="game-board-rotator" data-board-rot={boardRotation || undefined}>
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
                // Composed into gesture math only (tap zones, swipes) — never
                // added to the panel's own CSS rotation above, which already
                // picks this up for free by being nested inside the rotated
                // `.game-board-rotator`.
                boardRotation={boardRotation}
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
                isNextTurn={nextSeat === p.seat && activeSeat !== p.seat}
                isMonarch={designations.monarch === p.seat}
                isInitiative={designations.initiative === p.seat}
                highRollRolls={highRollState ? (highRollState.rolls[p.seat] ?? null) : null}
                isHighRollWinner={highRollState?.winnerSeat === p.seat}
                highRollActive={highRollState != null}
                onHighRollDismiss={dismissHighRoll}
                keypadOpen={keypadSeat === p.seat}
                onOpenKeypad={() => setKeypadSeat(p.seat)}
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
              if (cmdFocus) {
                exitCmdFocus();
                return;
              }
              // A synthesized click from Enter/Space carries detail 0; a real
              // pointer click's is >=1 (see hubOpenedByKeyboard above).
              if (!hubOpen) setHubOpenedByKeyboard(e.detail === 0);
              setHubOpen((v) => !v);
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
            <BoardHubMenu
              hubRef={hubBtnRef}
              onClose={() => setHubOpen(false)}
              petals={hubPetals}
              openedByKeyboard={hubOpenedByKeyboard}
              boardRotation={boardRotation}
            />
          )}

          {/* Undo is the seam's one remaining satellite (the clock moved to the
            edge strip below, see the ruling in STYLE_GUIDE). On a row seam it
            sits beside the hub, over the gutter; on a column seam the hub is a
            four-corner crossing, so it takes the middle of an adjacent panel's
            edge instead — see `seamSatellite`. Hidden while the hub's ring is
            open (the ring hides it rather than risk a petal landing on top of
            it) — the clock strip below is NOT hidden for this: it moved out
            of the seam entirely, so a petal can't reach it. */}
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

        {/* The table clock: a full-width edge strip along the board's bottom
            (the device holder's edge), screen-relative to the BOARD (never
            rotated to a seat) — but it rotates with the board's own
            landscape counter-rotation, same as everything else in this
            wrapper, so it stays at the device's physical bottom edge rather
            than the current screen's. A flex sibling of the grid above, not
            an overlay — the grid shrinks to make room for it, it never sits
            on top of a seat. Hidden in commander-damage focus mode, same as
            the old seam satellite: that mode strips the board down to the
            damage question. */}
        {showClockStrip && !cmdFocus && (
          <GameClock
            game={game}
            dispatch={dispatchTracked}
            canEdit={canControlAll}
            showTotal={gameTimerEnabled}
            showTurn={turnTrackerEnabled}
          />
        )}

        {game.status === 'finished' && (
          // Whole-table moment, not per-seat gameplay: never rotated to the
          // WINNER's seat specifically (B7-01) — everyone at the table reads
          // it the same way, the same as the confetti layer above it. Still
          // rotates with the board's own landscape lock, like every other
          // overlay in this wrapper.
          <WinCelebration game={game} onDone={onLeave} onRematch={onRematch} />
        )}

        {/* Board-level keypad (Lotus's model): dims and covers the whole
            board, rotated to face the seat it's for — never constrained by
            one seat's cell size the way the old in-panel cover was. Inside
            the rotator like every other overlay here, so it rotates with
            the board's own landscape lock too. */}
        {keypadPlayer && (
          <LifeKeypad
            playerName={keypadPlayer.name}
            currentLife={keypadPlayer.life}
            rotation={keypadRotation}
            onConfirm={(value) => {
              dispatchTracked({
                type: 'set-life',
                seat: keypadPlayer.seat,
                value,
                actorSeat: keypadPlayer.seat,
              });
              closeKeypad();
            }}
            onClose={closeKeypad}
          />
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
            showTurnTracker={turnTrackerEnabled}
            onClose={() => setHintOpen(false)}
          />
        )}
      </div>

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

/**
 * A numeral's digits, underlining 6 and 9 when the device pref is on (Lotus's
 * "Underlined 6 and 9" — the two digits a table reads upside down). Off, this
 * returns the plain number so the rendered DOM is identical to before the
 * pref existed. Shared by the life/commander-damage numeral and the high-roll
 * value — every board number that could sit upside down across a table.
 */
function numeralDigits(value: number, underline: boolean): ReactNode {
  if (!underline) return value;
  return String(value)
    .split('')
    .map((ch, i) =>
      ch === '6' || ch === '9' ? (
        <span key={i} className="pp-digit-underline">
          {ch}
        </span>
      ) : (
        ch
      )
    );
}

function PlayerPanel({
  player,
  game,
  dispatch,
  slot,
  rotation,
  boardRotation,
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
  isNextTurn,
  isMonarch,
  isInitiative,
  highRollRolls,
  isHighRollWinner,
  highRollActive,
  onHighRollDismiss,
  keypadOpen,
  onOpenKeypad,
}: {
  player: GamePlayer;
  game: GameState;
  dispatch: (a: GameAction) => void;
  slot: SeatSlot;
  rotation: number;
  /** The board's own landscape "keep it still" counter-rotation (0/90/-90).
   *  Never applied to CSS — the panel's own transform already inherits it
   *  by nesting — only composed into gesture math below, which reads raw
   *  screen-space pointer coordinates that don't know about CSS transforms. */
  boardRotation: 0 | 90 | -90;
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
  /** Whether `pass-turn` would move to this seat right now — a quiet,
   *  read-only cue, never a control. */
  isNextTurn: boolean;
  /** Designations held by this player. */
  isMonarch: boolean;
  isInitiative: boolean;
  /** This seat's own roll history, while a board-level High Roll is showing:
   *  index 0 is the first roll, further entries are tiebreak re-rolls. */
  highRollRolls: number[] | null;
  isHighRollWinner: boolean;
  /** A High Roll is showing on SOME seat — every panel freezes its taps. */
  highRollActive: boolean;
  onHighRollDismiss: () => void;
  /** Whether the board-level keypad (owned by `GameBoard`) is open for THIS
   *  seat — used only to gate this panel's own life taps while it's up. */
  keypadOpen: boolean;
  onOpenKeypad: () => void;
}) {
  // Real pointer events (clientX/clientY, and the deltas tap-and-hold derives
  // from them) always report true screen-space coordinates — CSS transforms
  // never affect them. The panel's own visual rotation composes with the
  // board's landscape counter-rotation automatically through DOM nesting, so
  // anything reading raw pointer coordinates needs the SUM to correctly map
  // screen-space back to "this seat's own up/down/left/right" — the panel's
  // CSS rotation alone (`rotation`) is no longer the whole story once the
  // board itself is rotated.
  const gestureRotation = (((rotation + boardRotation) % 360) + 360) % 360;
  const lowLifeWarningEnabled = usePlayStore((st) => st.lowLifeWarningEnabled);
  const underlineSixNine = usePlayStore((st) => st.underlineSixNine);
  const minimalistMode = usePlayStore((st) => st.minimalistMode);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
      // `rect` is the axis-aligned screen box — it reflects EVERY ancestor's
      // CSS transform, including the board's own landscape counter-rotation,
      // not just this panel's own. Map the hit (as a fraction of that box)
      // back into the panel's own un-rotated coordinate space so the chip
      // lands under the finger on every seat rotation (the default 4p layout
      // uses 90°/270° side seats, not just the 180° top seat) AND under a
      // board-level counter-rotation. Inverse of a center-origin clockwise
      // CSS rotate, by the TOTAL (seat + board) rotation. 90/270 swap the box
      // dimensions, which the fraction math absorbs since we work in
      // percentages.
      const sx = ((clientX - rect.left) / rect.width) * 100;
      const sy = ((clientY - rect.top) / rect.height) * 100;
      let x = sx;
      let y = sy;
      if (gestureRotation === 90) {
        x = sy;
        y = 100 - sx;
      } else if (gestureRotation === 180) {
        x = 100 - sx;
        y = 100 - sy;
      } else if (gestureRotation === 270) {
        x = 100 - sy;
        y = sx;
      }
      lastPointerRef.current = { x, y };
    },
    [gestureRotation]
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
    rotation: gestureRotation,
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
    rotation: gestureRotation,
    holdStep: HOLD_JUMP,
    disabled,
  });

  const isSideways = rotation === 90 || rotation === 270;
  // Ambient "danger" pulse when a player is in topdeck range but still alive.
  // Lotus's own low health warning fires below 10; device pref, default on.
  const isLowLife =
    lowLifeWarningEnabled &&
    game.status === 'active' &&
    !player.eliminated &&
    player.life >= 1 &&
    player.life <= 9;
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
        } ${isCmdSplit ? 'is-cmd-split' : ''} ${minimalistMode ? 'is-minimalist' : ''}`}
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
              <div className="pp-cmd-split-halves">
                <CmdSplitHalf
                  name={cmdSourceLabel}
                  value={cmdValue}
                  disabled={disabled}
                  handlers={tapHandlers}
                  stepLabel={(d) => stepLabel(d, false)}
                  onStep={(d) => adjust(d, false, false)}
                  underline={underlineSixNine}
                />
                <CmdSplitHalf
                  name={player.partner!}
                  value={cmdPartnerValue}
                  disabled={disabled}
                  handlers={partnerTapHandlers}
                  stepLabel={(d) => stepLabel(d, true)}
                  onStep={(d) => adjust(d, false, true)}
                  underline={underlineSixNine}
                />
              </div>
              {/* The panel's aria-label already carries "dealt to <name>", so
                  there's no visible caption. This seat's own life is a small
                  in-flow readout BELOW the halves, at the same bottom edge the
                  single-commander panel's corner chip uses: above them it sat
                  on the seat's name (measured on every board), and as an
                  absolutely-positioned chip it landed on a half's − button. */}
              <span className="pp-life-chip">{player.life} life</span>
            </div>
          ) : (
            <div className="player-panel-life-wrap">
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
                  onOpenKeypad();
                }}
              >
                <span key={popKey} className="player-panel-life-num is-pop">
                  {numeralDigits(animatedLife, underlineSixNine)}
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
              just because you're logging damage. The split (Partner) case
              renders its own chip in flow above, inside .pp-cmd-split-wrap —
              this absolutely-positioned corner chip would otherwise land on
              that half's own − button on a short panel. */}
          {cmdTarget && !isCmdSplit && (
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
              that player. Marks only: the drawer is where they change hands.
              "Up next" shares the same rail (and so the same seam-keepout
              placement, already collision-tested against every layout) —
              deliberately faint and icon-only, a quiet cue rather than a
              third designation. */}
          {(isMonarch || isInitiative || isNextTurn) && (
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
              {isNextTurn && (
                <span className="pp-designation-chip is-next" role="img" aria-label="Up next">
                  <ChevronRight width={14} height={14} aria-hidden />
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
        {highRollRolls != null && (
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
              <Dices width={20} height={20} strokeWidth={2} />
            </span>
            <span className="pp-highroll-value" aria-live="polite">
              {numeralDigits(highRollRolls[0], underlineSixNine)}
            </span>
            {/* A tied seat's decisive value is its LAST roll — show the
                tiebreak(s) beneath the first roll so the winner is visibly
                the one whose tiebreak came out highest, never a loser who
                merely rolled higher on the first throw. */}
            {highRollRolls.length > 1 && (
              <span className="pp-highroll-tiebreak">
                then {highRollRolls.slice(1).join(' · then ')}
              </span>
            )}
            {isHighRollWinner && <span className="pp-highroll-caption">goes first</span>}
          </div>
        )}

        {/* The focused player's own panel carries the mode's title and the
            explicit way out, at the player's own edge — it's already rotated
            to face them, and it's where they're looking while their life
            ticks down. A single compact line (never wrapping) so it reserves
            a fixed, small strip rather than eating the numeral above it —
            `.player-panel.is-cmd-self` pads the content box by the same
            height this bar takes, so the two can never overlap regardless of
            panel size. Title truncates with an ellipsis rather than
            shortening the copy outright — "Commander damage" is the word
            that actually carries the mode's meaning. The Return pill matches
            the hub's own "Return to game" copy (STYLE_GUIDE) at any size
            that fits it; only a genuinely narrow/short panel swaps to the
            bare "Return" — a container-query text swap, not a shorter
            button by default. */}
        {isCmdSelf && (
          <div className="pp-cmd-focus-bar">
            {/* The seat's name corner is hidden while it holds focus (space for
                the numeral), so the title carries the name for a screen reader. */}
            <span className="pp-cmd-focus-title">
              <span className="visually-hidden">{player.name}: </span>
              Commander damage received
            </span>
            <button
              type="button"
              className="pp-cmd-focus-done"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onCmdFocusExit();
              }}
            >
              {/* No aria-hidden on either span: CSS toggles which one is
                  `display: none` for the panel's size, and a display:none
                  element drops out of the button's accessible name on its
                  own — the announced label always matches what's shown. */}
              <span className="pp-cmd-focus-done-full">Return to game</span>
              <span className="pp-cmd-focus-done-short">Return</span>
            </button>
          </div>
        )}

        {drawerOpen && (
          <SeatMenu
            player={player}
            game={game}
            canEdit={canEdit}
            canLayout={canLayout}
            rotation={gestureRotation}
            dispatch={dispatch}
            onClose={() => setDrawerOpen(false)}
            onCommanderDamage={canFocusCmd ? onCmdFocus : undefined}
            isActiveTurn={isActiveTurn}
            isMonarch={isMonarch}
            isInitiative={isInitiative}
          />
        )}

        {game.winnerSeat === player.seat && <div className="player-panel-winner-tag">Winner</div>}
        {player.eliminated && game.winnerSeat !== player.seat && (
          <div className="player-panel-eliminated-tag">Out</div>
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
  underline,
}: {
  name: string;
  value: number;
  disabled: boolean;
  /** A tap-and-hold factory bound to THIS commander (primary or partner). */
  handlers: (arg: number) => Record<string, unknown>;
  stepLabel: (delta: number) => string;
  onStep: (delta: number) => void;
  underline: boolean;
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
          {numeralDigits(value, underline)}
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
  const visible = !dismissed && (isDraw || !!winner);
  // F10: while showing, the seat buttons and hub behind the celebration are
  // still in the tab order without this — the celebration renders INSIDE the
  // board's own DOM (not a portal), so `aria-modal` on its card alone traps
  // nothing.
  const celebrationRootRef = useRef<HTMLDivElement>(null);
  // Bounded to the board itself: GameBoard's own useBackgroundInert call
  // already owns everything OUTSIDE `.game-board` (see there for why a
  // ref-based boundary can't be used here instead).
  useBackgroundInert(visible, celebrationRootRef, '.game-board');
  if (!visible) return null;
  return (
    <div
      ref={celebrationRootRef}
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
