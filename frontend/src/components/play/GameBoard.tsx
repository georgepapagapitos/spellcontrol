import { Compass, Crown, MoreHorizontal, Undo2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, GamePlayer, GameState } from '../../lib/game-state';
import { cmdDamageKey } from '../../lib/game-state';
import type { EmptyCell, SeatSlot } from '../../lib/board-layouts';
import { isCustomLayout, resolveLayout, undoButtonParams } from '../../lib/board-layouts';
import { paletteForSeat } from '../../lib/seat-palette';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { useFloatingDelta } from '../../lib/use-floating-delta';
import { haptics } from '../../lib/haptics';
import { useWakeLock } from '../../lib/use-wake-lock';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useOverlayDismiss } from '../../lib/use-overlay-dismiss';
import { capture, clearUndo, peekLabel, popRestore, runSuppressed } from '../../lib/undo-stack';
import { useCardThumb } from '../../lib/card-thumbs';
import { scryfallArtCrop } from '../../lib/offline/slim-to-scryfall';
import { cmdDamageFillRatio, cmdDamageToLethal } from '../../lib/cmd-damage';
import { useTapAndHold } from '../../lib/tap-and-hold';
import { LifeKeypad } from './LifeKeypad';
import { ShareDialog } from '../ShareDialog';
import { SeatMenu } from './SeatMenu';
import { GameMenu } from './GameMenu';
import { GameRecap } from './GameRecap';

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
 * Interaction model is touch-first: tap the left half of a panel to decrement
 * life, the right half to increment (top/bottom when tapOrientation is
 * vertical). Press and hold to repeat. Visible ±1 step buttons sit on the
 * edges as a discoverable backup.
 *
 * Commander damage is a board-level *focus mode* rather than a per-panel
 * drawer: one player claims focus (⚔ chip or swipe up on their own panel) and
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
  const [shareOpen, setShareOpen] = useState(false);
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

  // Lock body scroll while the board is mounted — it's a fullscreen overlay.
  useLockBodyScroll();

  return (
    <div
      className={`game-board game-board-${Math.min(total, 6)} layout-${
        isCustomLayout(board.id) ? 'custom' : board.id
      } mode-${game.mode}${cmdFocus ? ' is-cmd-focus' : ''}`}
      data-shared={isShared || undefined}
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
          className="game-board-menu-btn"
          style={{
            ['--seam-top-pct' as never]:
              'row' in board.seam ? `${(board.seam.row / board.rows) * 100}%` : '50%',
            ['--seam-left-pct' as never]:
              'col' in board.seam ? `${(board.seam.col / board.cols) * 100}%` : '50%',
          }}
          aria-label="Game menu"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(true);
          }}
        >
          <MoreHorizontal width={22} height={22} strokeWidth={2} aria-hidden />
        </button>

        {undoLabel && (
          <button
            type="button"
            className="game-board-undo-btn"
            style={{
              ['--seam-top-pct' as never]:
                'row' in board.seam ? `${(board.seam.row / board.rows) * 100}%` : '50%',
              ['--seam-left-pct' as never]:
                'col' in board.seam ? `${(board.seam.col / board.cols) * 100}%` : '50%',
              // undoButtonParams drives offset direction (row-seam=left, col-seam=above)
              // and icon rotation (0° for row, 90° for col). Two size variants let the
              // CSS media query pick the right offset at ≥600px without recalculating.
              ['--undo-tx' as never]: undoButtonParams(board.seam).tx,
              ['--undo-ty' as never]: undoButtonParams(board.seam).ty,
              ['--undo-tx-lg' as never]: undoButtonParams(board.seam, '4rem').tx,
              ['--undo-ty-lg' as never]: undoButtonParams(board.seam, '4rem').ty,
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

      {game.status === 'finished' &&
        (() => {
          // A draw (winnerSeat null) still gets the overlay — no seat to
          // rotate toward, so it renders unrotated.
          const winnerSeatIdx =
            game.winnerSeat != null
              ? game.players.findIndex((p) => p.seat === game.winnerSeat)
              : -1;
          const winnerSlot = winnerSeatIdx >= 0 ? board.seats[winnerSeatIdx] : null;
          const winnerRot = isShared && winnerSlot ? winnerSlot.rot : 0;
          return (
            <WinCelebration
              game={game}
              rotation={winnerRot}
              onDone={onLeave}
              onRematch={onRematch}
            />
          );
        })()}

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
          onShare={() => setShareOpen(true)}
        />
      )}

      {shareOpen && (
        <ShareDialog
          kind="game-result"
          resourceId={game.id}
          resourceLabel="this game"
          onClose={() => setShareOpen(false)}
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
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seatMenuOpen, setSeatMenuOpen] = useState(false);
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
      seatMenuOpen ||
      drawerOpen ||
      keypadOpen;
  // The counters popover's OWN +/- controls must stay live while it's open,
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

  // Corner chips remain the tap/keyboard affordance; swipe-up is an additive
  // shortcut for the common in-game move (log what just hit you without
  // hunting for a small chip). Commander damage claims the gesture when it's
  // enabled — it's the frequent one — and poison keeps the counters cover.
  // `rotation` makes "up" panel-local, so it means up *for that seat*.
  // A vertical swipe also cancels the pending life tap/hold inside the hook.
  const canOpenCounters = canEdit && !player.eliminated && game.status !== 'finished';
  const tapHandlers = useTapAndHold({
    onTap: (delta: number) => adjust(delta),
    onHoldTick: (delta: number, gearUp: boolean) => adjust(delta, gearUp),
    onPointerStart: (e) => recordPointer(e.clientX, e.clientY),
    onPointerMove: (e) => recordPointer(e.clientX, e.clientY),
    onSwipeUp: cmdFocus
      ? undefined
      : canOpenCounters && game.commanderDamageEnabled
        ? onCmdFocus
        : canOpenCounters && game.poisonEnabled
          ? () => setDrawerOpen(true)
          : undefined,
    // Swiping back down leaves focus mode. Panel-local like every other board
    // gesture, so on your own panel it's the exact reverse of the swipe that
    // opened it; the button and Esc cover anyone reaching across the table.
    onSwipeDown: cmdFocus ? onCmdFocusExit : undefined,
    rotation,
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
        className={`player-panel ${colorKey ? `pp-color-${colorKey}` : 'pp-seat'} ${
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
            ? `${player.name}: commander damage dealt to ${cmdTarget!.name} — ${cmdSourceLabel} ${cmdValue}, ${player.partner} ${cmdPartnerValue}`
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
            {/* A button (not a label) so a tap on the name opens the seat menu
                instead of falling through to the −1 tap zone beneath it. */}
            <button
              type="button"
              className="player-panel-name"
              title={player.name}
              aria-label={`${player.name} — seat menu`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setSeatMenuOpen((v) => !v);
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

          {/* Hidden in focus mode: it would collide with the return bar, and
              seat admin isn't what anyone is doing mid-damage-log. */}
          {!cmdFocus && (
            <button
              type="button"
              className="player-panel-menu-btn is-corner-br"
              aria-label="Seat menu"
              onClick={(e) => {
                e.stopPropagation();
                setSeatMenuOpen((v) => !v);
              }}
            >
              ⋯
            </button>
          )}

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
                    : `Set life — currently ${player.life}`
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

          {!cmdFocus && (game.poisonEnabled || game.commanderDamageEnabled) && (
            <div className="player-panel-counters">
              {game.poisonEnabled && (
                <button
                  type="button"
                  className={`pp-counter-chip ${player.poison >= 10 ? 'is-lethal' : ''}`}
                  aria-label={`Poison ${player.poison}. Open counters`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDrawerOpen(true);
                  }}
                >
                  <span className="pp-counter-icon" aria-hidden="true">
                    ☠
                  </span>
                  {player.poison}
                </button>
              )}
              {game.commanderDamageEnabled && (
                <button
                  type="button"
                  className={`pp-counter-chip ${maxCmdDmg >= 21 ? 'is-lethal' : ''}`}
                  aria-label={`Commander damage, highest ${maxCmdDmg}. Log damage you've received`}
                  disabled={!canOpenCounters}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCmdFocus();
                  }}
                >
                  <span className="pp-counter-icon" aria-hidden="true">
                    ⚔
                  </span>
                  {maxCmdDmg}
                </button>
              )}
            </div>
          )}

          {/* Designation chips — shown at top-right so they don't collide with
              counters (bottom-left). They render inside the rotated panel so they
              always read upright for that seat. */}
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
          <CountersPopover
            player={player}
            game={game}
            disabled={countersDisabled}
            rotation={rotation}
            dispatch={dispatch}
            onClose={() => setDrawerOpen(false)}
          />
        )}

        {seatMenuOpen && (
          <SeatMenu
            player={player}
            game={game}
            canEdit={canEdit}
            canLayout={canLayout}
            dispatch={dispatch}
            onClose={() => setSeatMenuOpen(false)}
            isActiveTurn={isActiveTurn}
            isMonarch={isMonarch}
            isInitiative={isInitiative}
          />
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

// ── Counters popover (poison) ──────────────────────────────────────────────

/**
 * Full-panel counters cover, opened by tapping the poison chip and dismissed
 * by swiping back down (or the ✕ / Esc). Lives inside the panel so it
 * inherits the seat's rotation and reads upright for that player.
 *
 * Commander damage is NOT here — it's the board-level focus mode (see
 * `PlayerPanel`), which puts each opponent's damage on that opponent's own
 * seat instead of in a list.
 */
function CountersPopover({
  player,
  game,
  disabled,
  rotation,
  dispatch,
  onClose,
}: {
  player: GamePlayer;
  game: GameState;
  disabled: boolean;
  /** Panel rotation, so swipe-to-dismiss is panel-local for every seat. */
  rotation: number;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
}) {
  // Reuse the tap/hold hook purely as a swipe detector: `disabled` skips the
  // tap + hold-repeat arming but still records the pointer start and fires
  // the swipe callbacks. Bubbles from the tiles too, so a downward drag
  // started anywhere on the cover dismisses it (and the tile's own hook
  // cancels its pending tap at the same threshold, so nothing double-fires).
  const swipeHandlers = useTapAndHold({
    onTap: () => {},
    onHoldTick: () => {},
    onSwipeDown: onClose,
    rotation,
    disabled: true,
  });
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayDismiss(onClose, panelRef);
  return (
    <div
      ref={panelRef}
      className="pp-counters-cover"
      role="dialog"
      aria-modal="true"
      aria-label={`${player.name} counters`}
      onClick={(e) => e.stopPropagation()}
      {...swipeHandlers(0)}
    >
      <div className="pp-counters-inner">
        {/* Grab handle — the conventional "this dismisses by swiping" tell.
            Decorative: the ✕ beside it is the accessible control. */}
        <span className="pp-counters-grab" aria-hidden="true" />
        <div className="pp-counters-head">
          <span className="pp-counters-title">Counters</span>
          <button
            type="button"
            className="pp-counters-close"
            aria-label="Close counters"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
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
        </div>
      </div>
    </div>
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
}: {
  label: string;
  value: number;
  disabled: boolean;
  lethal: boolean;
  onChange: (delta: number) => void;
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
  rotation = 0,
  onDone,
  onRematch,
}: {
  game: GameState;
  rotation?: number;
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
      role="dialog"
      aria-label={winner ? `${winner.name} wins` : 'Game over — no winner'}
      onClick={() => setDismissed(true)}
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
        style={{
          ...(palette ? { ['--win-accent' as never]: palette.edge } : undefined),
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
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
          <span className="win-celebration-sub">Game over — no winner</span>
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
