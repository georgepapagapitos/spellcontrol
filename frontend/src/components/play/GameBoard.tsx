import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { MoreHorizontal, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, GameLayout, GamePlayer, GameState } from '../../lib/game-state';
import { makePlayer } from '../../lib/game-state';
import type { BoardLayout, EmptyCell, SeatSlot } from '../../lib/board-layouts';
import {
  encodeCustomLayout,
  isCustomLayout,
  layoutsForCount,
  resolveLayout,
} from '../../lib/board-layouts';
import {
  applyPlacement,
  deriveSeam,
  occupancyOf,
  rangeFree,
  rangeFreeRows,
  type Placement,
} from '../../lib/custom-layout';
import { paletteForIndex, paletteForSeat } from '../../lib/seat-palette';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { useFloatingDelta } from '../../lib/use-floating-delta';
import { haptics } from '../../lib/haptics';
import { useWakeLock } from '../../lib/use-wake-lock';
import { capture, clearUndo, peekLabel, popRestore, runSuppressed } from '../../lib/undo-stack';
import { usePlayStore } from '../../store/play';
import { LifeKeypad } from './LifeKeypad';
import { GameHistory } from './GameHistory';
import { GameTools } from './GameTools';
import { ViewModeToggle } from '../ViewModeToggle';

interface Props {
  game: GameState;
  /** Apply an action to the underlying store. */
  dispatch: (action: GameAction) => void;
  /** True when the viewer controls every seat (local) or is the host (online). */
  canControlAll: boolean;
  /** Authed user id, for online games. */
  viewerUserId?: string | null;
  /** Banner shown at the bottom of the overlay (e.g. join code). */
  banner?: React.ReactNode;
  /** Error to show inline. */
  errorMessage?: string | null;
  /** Hide the board overlay while keeping the game intact (resumable). */
  onMinimize?: () => void;
  /** Destroy the game (local discard / online leave-and-end). */
  onLeave?: () => void;
  /** Confirm-end-game flow trigger. */
  onEnd?: () => void;
  /** Start a fresh local game with this game's roster + settings. */
  onRematch?: () => void;
}

/**
 * Fullscreen MTG life-counter board. Each player gets a panel sized to fill
 * the viewport (so a 4-player game = 2×2 grid, 2-player = stacked halves,
 * 3-player = top pair + bottom full-width). Local (shared-device) games
 * rotate top-row panels 180° so each player reads upright when the phone is
 * passed across the table. Online games never rotate — each device is in
 * front of one player at a time.
 *
 * Interaction model is touch-first: tap the left half of a panel to decrement
 * life, the right half to increment (top/bottom when tapOrientation is
 * vertical). Press and hold to repeat. Visible ±1 step buttons sit on the
 * edges as a discoverable backup. Commander damage lives in a slide-down
 * drawer so it doesn't crowd the resting view.
 */
export function GameBoard({
  game,
  dispatch,
  canControlAll,
  viewerUserId,
  banner,
  errorMessage,
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

  // Lock body scroll while the board is mounted — it's a fullscreen overlay.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className={`game-board game-board-${Math.min(total, 6)} layout-${
        isCustomLayout(board.id) ? 'custom' : board.id
      } mode-${game.mode}`}
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
          return (
            <PlayerPanel
              key={p.id}
              player={p}
              game={game}
              dispatch={dispatchTracked}
              slot={slot}
              // Rotation only applies in shared (local) mode — on online
              // games each device is in front of its owner, always upright.
              rotation={isShared ? slot.rot : 0}
              canEdit={canControlAll || (viewerUserId != null && p.userId === viewerUserId)}
              canLayout={canControlAll}
              opponents={game.players.filter((o) => o.seat !== p.seat)}
              undoNonce={undoNonce}
            />
          );
        })}
        {(board.empty ?? []).map((cell, i) => (
          <EmptyPanel key={`empty-${i}`} cell={cell} />
        ))}
      </div>

      {/* Floating central hub at the layout's seam — the boundary
          between rotated (far-side) and upright (near-side) seats.
          --seam-top-pct / --seam-left-pct position it precisely;
          row-seam layouts pin top by row index, col-seam layouts pin
          left by column index. */}
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

      {game.status === 'finished' && game.winnerSeat != null && <WinCelebration game={game} />}

      {errorMessage && <div className="game-board-error">{errorMessage}</div>}
      {banner && <div className="game-board-banner">{banner}</div>}

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
  opponents,
  undoNonce,
}: {
  player: GamePlayer;
  game: GameState;
  dispatch: (a: GameAction) => void;
  slot: SeatSlot;
  rotation: number;
  canEdit: boolean;
  /** Viewer may change board geometry (local, or online host). */
  canLayout: boolean;
  opponents: GamePlayer[];
  /** Increments on every undo so the panel can drop stale burst chips. */
  undoNonce: number;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seatMenuOpen, setSeatMenuOpen] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [lethalFlash, setLethalFlash] = useState(false);
  // Life taps are blocked while any panel overlay is open (seat menu /
  // counters drawer) — otherwise a stray tap on the panel underneath the
  // overlay would change life unexpectedly while the user is picking a
  // color, opening counters, etc.
  // Gates the life tap-zones / step buttons: also off while any overlay
  // (seat menu / counters / keypad) is open so a tap underneath doesn't
  // leak through.
  const disabled =
    !canEdit ||
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
  const overrideKey = player.panelColorKey ? player.panelColorKey.toLowerCase() : null;
  const hasIdentity = Array.isArray(player.colorIdentity) && player.colorIdentity.length > 0;
  const identityClass = hasIdentity ? identityKey(player.colorIdentity) : null;
  const colorKey = overrideKey ?? identityClass;
  const seatPalette = useMemo(() => paletteForSeat(game.id, player.seat), [game.id, player.seat]);

  const { display: animatedLife, popKey } = useAnimatedNumber(player.life);
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

  const adjust = useCallback(
    (delta: number) => {
      if (disabled) return;
      dispatch({ type: 'life', seat: player.seat, delta, actorSeat: player.seat });
      pushDelta(delta, lastPointerRef.current.x, lastPointerRef.current.y);
      haptics.tap();
    },
    [disabled, dispatch, player.seat, pushDelta]
  );

  // Counters live in tappable corner chips now (see below) — the old
  // swipe-to-open-drawer gesture is gone, so tap/hold is the only panel
  // gesture. Swipe detection still cancels a stray vertical drag from
  // firing a life tap.
  const tapHandlers = useTapAndHold({
    onTap: (delta: number) => adjust(delta),
    onHoldTick: (delta: number) => adjust(delta),
    onPointerStart: (e) => recordPointer(e.clientX, e.clientY),
    onPointerMove: (e) => recordPointer(e.clientX, e.clientY),
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
        } ${isLowLife ? 'is-low-life' : ''}`}
        // Rotation is set as a CSS variable consumed by the .player-panel
        // transform rule so it composes cleanly with any other transforms.
        // When no identity / no override applies, the inline palette vars
        // take over as the fallback. Sideways panels (90 / 270) are sized
        // by the CSS to the parent cell's swapped dimensions before rotating
        // (see `.player-panel[data-sideways]`).
        style={{
          ['--pp-rot' as never]: `${rotation}deg`,
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
        aria-label={`${player.name}: ${player.life} life`}
      >
        {(game.tapOrientation ?? 'horizontal') === 'vertical' ? (
          <>
            <div className="player-panel-tapzone is-top" {...tapHandlers(1)} aria-label="+1 life" />
            <div
              className="player-panel-tapzone is-bottom"
              {...tapHandlers(-1)}
              aria-label="-1 life"
            />
          </>
        ) : (
          <>
            <div
              className="player-panel-tapzone is-left"
              {...tapHandlers(-1)}
              aria-label="-1 life"
            />
            <div
              className="player-panel-tapzone is-right"
              {...tapHandlers(1)}
              aria-label="+1 life"
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

          <div className="player-panel-life-wrap">
            <button
              type="button"
              className="player-panel-step-btn"
              aria-label="-1 life"
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
              aria-label={`Set life — currently ${player.life}`}
              aria-live="polite"
              disabled={!canEdit || game.status === 'finished'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (!canEdit || game.status === 'finished') return;
                setKeypadOpen(true);
              }}
            >
              <span key={popKey} className="player-panel-life-num is-pop">
                {animatedLife}
              </span>
            </button>
            <button
              type="button"
              className="player-panel-step-btn"
              aria-label="+1 life"
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

          {(game.poisonEnabled || game.commanderDamageEnabled) && (
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
                  aria-label={`Commander damage, highest ${maxCmdDmg}. Open counters`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDrawerOpen(true);
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
        </div>

        {drawerOpen && (
          <CountersPopover
            player={player}
            game={game}
            opponents={opponents}
            disabled={countersDisabled}
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

// ── Tap & hold ─────────────────────────────────────────────────────────────

interface TapAndHoldOpts {
  onTap: (arg: number) => void;
  onHoldTick: (arg: number) => void;
  onPointerStart?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  /** Panel rotation in degrees; affects swipe direction interpretation. */
  rotation?: number;
  disabled: boolean;
}

const SWIPE_THRESHOLD_PX = 40;
const SWIPE_AXIS_RATIO = 1.5;

/**
 * Hook that returns a getHandlers(arg) factory which produces the pointer
 * event handlers for a tap-and-hold zone. A single click fires `onTap(arg)`;
 * a long press (>=350ms) starts a repeater that fires `onHoldTick(arg)` every
 * 130ms until pointer-up or pointer-leave.
 *
 * Also detects vertical swipes: if the pointer moves >40px vertically (and
 * predominantly vertically) before lift, the hold timer is cancelled and
 * onSwipeUp/onSwipeDown fires instead of a tap or repeater. For 180°-rotated
 * panels, screen-space "down" is panel-local "up", so we invert.
 *
 * Using pointer events (not touch/mouse separately) lets the same handler
 * cover mouse, touch, and pen with no synthetic-click double-fire.
 */
function useTapAndHold({
  onTap,
  onHoldTick,
  onPointerStart,
  onPointerMove,
  onSwipeUp,
  onSwipeDown,
  rotation = 0,
  disabled,
}: TapAndHoldOpts) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heldRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);

  const clear = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (repeatTimer.current) clearInterval(repeatTimer.current);
    holdTimer.current = null;
    repeatTimer.current = null;
  };

  useEffect(() => () => clear(), []);

  return (arg: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled) {
        // Still record start so a swipe-up (e.g. open seat menu while
        // eliminated) can fire. But don't arm tap/hold.
        startRef.current = { x: e.clientX, y: e.clientY };
        swipedRef.current = false;
        onPointerStart?.(e);
        return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      heldRef.current = false;
      swipedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      onPointerStart?.(e);
      clear();
      holdTimer.current = setTimeout(() => {
        heldRef.current = true;
        onHoldTick(arg);
        repeatTimer.current = setInterval(() => onHoldTick(arg), 130);
      }, 350);
    },
    onPointerMove: (e: React.PointerEvent) => {
      onPointerMove?.(e);
      const s = startRef.current;
      if (!s || swipedRef.current) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dy) >= SWIPE_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx) * SWIPE_AXIS_RATIO) {
        // Crossed the swipe threshold — cancel any pending tap/hold.
        swipedRef.current = true;
        clear();
        const isScreenDown = dy > 0;
        // Panel rotated 180° → screen-down is panel-up.
        const isPanelUp = rotation === 180 ? isScreenDown : !isScreenDown;
        if (isPanelUp) onSwipeUp?.();
        else onSwipeDown?.();
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      const wasHeld = heldRef.current;
      const wasSwipe = swipedRef.current;
      clear();
      startRef.current = null;
      if (disabled) return;
      if (!wasHeld && !wasSwipe) onTap(arg);
    },
    onPointerCancel: () => {
      clear();
      startRef.current = null;
    },
    onPointerLeave: () => {
      clear();
      startRef.current = null;
    },
  });
}

// ── Counters popover (poison + commander damage) ───────────────────────────

/**
 * Compact popover opened by tapping a corner counter chip. Replaces the old
 * full-width "Counters" button + swipe-up drawer: the chips keep poison /
 * commander damage glanceable, and this popover (dismissed by tapping
 * outside) holds the +/- controls. Lives inside the panel so it inherits
 * the seat's rotation and reads upright for that player.
 */
function CountersPopover({
  player,
  game,
  opponents,
  disabled,
  dispatch,
  onClose,
}: {
  player: GamePlayer;
  game: GameState;
  opponents: GamePlayer[];
  disabled: boolean;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="pp-counters-cover"
      role="dialog"
      aria-label={`${player.name} counters`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pp-counters-inner">
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
          {game.commanderDamageEnabled &&
            opponents.map((o) => (
              <CounterRow
                key={o.seat}
                label={`⚔ ${o.name}`}
                value={player.commanderDamage[o.seat] ?? 0}
                disabled={disabled}
                lethal={(player.commanderDamage[o.seat] ?? 0) >= 21}
                onChange={(d) =>
                  dispatch({
                    type: 'cmd-dmg',
                    seat: player.seat,
                    fromSeat: o.seat,
                    delta: d,
                    actorSeat: player.seat,
                  })
                }
              />
            ))}
        </div>
      </div>
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
  return (
    <div className={`counter-row ${lethal ? 'is-lethal' : ''}`}>
      <span className="counter-row-label">{label}</span>
      <div className="counter-row-controls">
        <button
          type="button"
          className="counter-row-btn"
          aria-label={`-1 ${label}`}
          disabled={disabled}
          onClick={() => onChange(-1)}
        >
          −
        </button>
        <span className="counter-row-value">{value}</span>
        <button
          type="button"
          className="counter-row-btn"
          aria-label={`+1 ${label}`}
          disabled={disabled}
          onClick={() => onChange(1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

// ── Per-seat menu (concede / set life manually) ───────────────────────────

const FACING_OPTIONS: { rot: 0 | 90 | 180 | 270; label: string }[] = [
  { rot: 0, label: 'Toward you' },
  { rot: 90, label: 'Right' },
  { rot: 180, label: 'Across' },
  { rot: 270, label: 'Left' },
];

/** Up-arrow rotated by `rot` — shows which way a seat's panel will read. */
function FacingArrow({ rot }: { rot: number }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      style={{ transform: `rotate(${rot}deg)` }}
    >
      <path
        d="M9 3.5 L9 14 M9 3.5 L5.5 7 M9 3.5 L12.5 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SeatMenu({
  player,
  game,
  canEdit,
  canLayout,
  dispatch,
  onClose,
}: {
  player: GamePlayer;
  game: GameState;
  canEdit: boolean;
  canLayout: boolean;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
}) {
  const [setLifeVal, setSetLifeVal] = useState<string>(String(player.life));
  // Rotation is only meaningful in shared (local) play — online each device
  // is already in front of its owner. Changing it converts the current
  // layout into a custom one (persisted in the opaque layout id).
  const current = resolveLayout(game.players.length, game.layout);
  const currentRot = current.seats[player.seat]?.rot ?? 0;
  const setFacing = (rot: 0 | 90 | 180 | 270) => {
    const seats = current.seats.map((st, i) => (i === player.seat ? { ...st, rot } : st));
    dispatch({
      type: 'settings',
      patch: { layout: encodeCustomLayout({ rows: current.rows, seam: current.seam, seats }) },
    });
  };
  return (
    <div className="seat-menu" role="dialog" onClick={(e) => e.stopPropagation()}>
      <header className="seat-menu-head">
        <span>{player.name}</span>
        <button type="button" className="seat-menu-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="seat-menu-body">
        {canEdit && game.status !== 'finished' && (
          <form
            className="seat-menu-form"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(setLifeVal);
              if (!Number.isFinite(n)) return;
              dispatch({
                type: 'set-life',
                seat: player.seat,
                value: n,
                actorSeat: player.seat,
              });
              onClose();
            }}
          >
            <label className="seat-menu-label">Set life to</label>
            <div className="seat-menu-row">
              <input
                type="number"
                inputMode="numeric"
                value={setLifeVal}
                onChange={(e) => setSetLifeVal(e.target.value)}
              />
              <button type="submit" className="pill-btn pill-btn-primary">
                Set
              </button>
            </div>
          </form>
        )}
        {canEdit && (
          <div className="seat-menu-colors">
            <span className="seat-menu-label">Panel color</span>
            <div className="seat-menu-swatches" role="radiogroup" aria-label="Panel color">
              {(['W', 'U', 'B', 'R', 'G', 'M', 'C'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={player.panelColorKey === k}
                  aria-label={SWATCH_LABEL[k]}
                  className={`seat-menu-swatch pp-color-${k.toLowerCase()} ${
                    player.panelColorKey === k ? 'is-selected' : ''
                  }`}
                  onClick={() => {
                    dispatch({
                      type: 'update-player',
                      seat: player.seat,
                      patch: { panelColorKey: k },
                    });
                  }}
                />
              ))}
              <button
                type="button"
                className={`seat-menu-swatch is-auto ${
                  player.panelColorKey === null ? 'is-selected' : ''
                }`}
                style={{
                  ['--pp-base' as never]: paletteForSeat(game.id, player.seat).base,
                  ['--pp-edge' as never]: paletteForSeat(game.id, player.seat).edge,
                }}
                aria-label="Seat default (auto from commander color identity)"
                title="Seat default"
                onClick={() => {
                  dispatch({
                    type: 'update-player',
                    seat: player.seat,
                    patch: { panelColorKey: null },
                  });
                }}
              />
            </div>
            <span className="seat-menu-color-hint">
              Seat default uses your deck&apos;s color identity, or your seat color if none.
            </span>
          </div>
        )}
        {canLayout && game.mode === 'local' && (
          <div className="seat-menu-facing">
            <span className="seat-menu-label">Panel facing</span>
            <div className="seat-menu-facing-row" role="radiogroup" aria-label="Panel facing">
              {FACING_OPTIONS.map((opt) => (
                <button
                  key={opt.rot}
                  type="button"
                  role="radio"
                  aria-checked={currentRot === opt.rot}
                  aria-label={opt.label}
                  title={opt.label}
                  className={`seat-menu-facing-btn ${currentRot === opt.rot ? 'is-selected' : ''}`}
                  onClick={() => setFacing(opt.rot)}
                >
                  <FacingArrow rot={opt.rot} />
                </button>
              ))}
            </div>
            <span className="seat-menu-color-hint">
              Rotate this seat so the player reads it upright from their chair.
            </span>
          </div>
        )}
        {canEdit && game.status !== 'finished' && (
          <button
            type="button"
            className="seat-menu-action"
            onClick={() => {
              dispatch({
                type: 'eliminate',
                seat: player.seat,
                eliminated: !player.eliminated,
              });
              onClose();
            }}
          >
            {player.eliminated ? 'Revive' : 'Concede'}
          </button>
        )}
      </div>
    </div>
  );
}

const SWATCH_LABEL: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'M' | 'C', string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  M: 'Multicolor',
  C: 'Colorless',
};

// ── Center game menu (end / reset / log) ───────────────────────────────────

function GameMenu({
  game,
  canControlAll,
  dispatch,
  onClose,
  onMinimize,
  onLeave,
  onEnd,
  onRematch,
  onUndo,
  undoLabel,
}: {
  game: GameState;
  canControlAll: boolean;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
  onMinimize?: () => void;
  onLeave?: () => void;
  onEnd?: () => void;
  onRematch?: () => void;
  onUndo: () => void;
  undoLabel: string | null;
}) {
  const isFinished = game.status === 'finished';
  const hapticsEnabled = usePlayStore((s) => s.hapticsEnabled);
  const setHaptics = usePlayStore((s) => s.setHaptics);
  const preferredLayouts = usePlayStore((s) => s.preferredLayouts);
  const setPreferredLayout = usePlayStore((s) => s.setPreferredLayout);
  const [editorOpen, setEditorOpen] = useState(false);
  return (
    <div className="game-menu-backdrop" onClick={onClose}>
      <div className="game-menu" role="dialog" onClick={(e) => e.stopPropagation()}>
        <span className="game-menu-grabber" aria-hidden="true" />
        <header className="game-menu-head">
          <div className="game-menu-title">
            <span className="game-menu-title-main">
              {game.mode === 'online' ? `Game ${game.code}` : 'Local game'}
            </span>
            <span className="game-menu-title-sub">{game.format}</span>
          </div>
          <button type="button" className="game-menu-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="game-menu-body">
          <div className="game-menu-meta" aria-label="Game settings">
            <span className="game-menu-chip">{game.startingLife} starting life</span>
            {game.commanderDamageEnabled && (
              <span className="game-menu-chip">Commander damage</span>
            )}
            {game.poisonEnabled && <span className="game-menu-chip">Poison</span>}
            <span className="game-menu-chip is-mode">{game.mode}</span>
          </div>

          <GameTools game={game} dispatch={dispatch} />

          {canControlAll && !isFinished && (
            <section className="game-menu-section">
              <PlayerRoster game={game} dispatch={dispatch} />
            </section>
          )}

          {canControlAll && !isFinished && (
            <section className="game-menu-section">
              <LayoutPicker
                total={game.players.length}
                current={resolveLayout(game.players.length, game.layout).id}
                shared={game.mode === 'local'}
                onPick={(layout) => dispatch({ type: 'settings', patch: { layout } })}
                onCustomize={() => setEditorOpen(true)}
              />
              {game.mode === 'local' &&
                (() => {
                  const count = game.players.length;
                  const currentId = resolveLayout(count, game.layout).id;
                  const isDefault = preferredLayouts[count] === currentId;
                  return (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isDefault}
                      className={`game-menu-setting ${isDefault ? 'is-on' : ''}`}
                      onClick={() => setPreferredLayout(count, isDefault ? null : currentId)}
                    >
                      <span className="game-menu-setting-label">
                        Default for {count}-player games
                      </span>
                      <span className="game-menu-setting-state" aria-hidden="true">
                        {isDefault ? 'On' : 'Off'}
                      </span>
                    </button>
                  );
                })()}
            </section>
          )}

          {canControlAll && !isFinished && (
            <section className="game-menu-section">
              <ViewModeToggle
                className="tap-orientation-toggle"
                ariaLabel="Tap zone orientation"
                value={game.tapOrientation ?? 'horizontal'}
                onChange={(next) => dispatch({ type: 'settings', patch: { tapOrientation: next } })}
                options={[
                  {
                    value: 'horizontal',
                    label: 'Horizontal taps',
                    icon: (
                      <>
                        <TapZoneIcon orientation="horizontal" />
                        <span>Horizontal taps</span>
                      </>
                    ),
                  },
                  {
                    value: 'vertical',
                    label: 'Vertical taps',
                    icon: (
                      <>
                        <TapZoneIcon orientation="vertical" />
                        <span>Vertical taps</span>
                      </>
                    ),
                  },
                ]}
              />
            </section>
          )}

          <GameHistory game={game} />

          <section className="game-menu-section">
            <button
              type="button"
              role="switch"
              aria-checked={hapticsEnabled}
              className={`game-menu-setting ${hapticsEnabled ? 'is-on' : ''}`}
              onClick={() => setHaptics(!hapticsEnabled)}
            >
              <span className="game-menu-setting-label">Haptic feedback</span>
              <span className="game-menu-setting-state" aria-hidden="true">
                {hapticsEnabled ? 'On' : 'Off'}
              </span>
            </button>
          </section>

          <section className="game-menu-section">
            <div className="game-menu-actions">
              {undoLabel && (
                <button
                  type="button"
                  className="game-menu-pill is-wide"
                  onClick={() => {
                    onUndo();
                    onClose();
                  }}
                >
                  ↶ Undo {undoLabel}
                </button>
              )}
              {isFinished && onRematch && (
                <button
                  type="button"
                  className="game-menu-pill is-primary is-wide"
                  onClick={() => {
                    onRematch();
                    onClose();
                  }}
                >
                  Rematch — same players
                </button>
              )}
              {onMinimize && !isFinished && (
                <button
                  type="button"
                  className="game-menu-pill is-primary is-wide"
                  onClick={() => {
                    onMinimize();
                    onClose();
                  }}
                >
                  Minimize
                </button>
              )}
              {!isFinished && (
                <div className="game-menu-actions-row">
                  <button
                    type="button"
                    className="game-menu-pill"
                    onClick={() => {
                      onEnd?.();
                      onClose();
                    }}
                  >
                    End game
                  </button>
                  {canControlAll && (
                    <button
                      type="button"
                      className="game-menu-pill"
                      onClick={() => {
                        dispatch({ type: 'reset' });
                        onClose();
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
              )}
              {onLeave && (
                <button
                  type="button"
                  className={`game-menu-pill is-wide ${isFinished ? '' : 'is-danger'}`}
                  onClick={() => {
                    onLeave();
                    onClose();
                  }}
                >
                  {isFinished ? 'Close' : 'Discard game'}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
      {editorOpen && (
        <CustomLayoutEditor
          game={game}
          onApply={(layout) => {
            dispatch({ type: 'settings', patch: { layout } });
            setEditorOpen(false);
          }}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}

// ── Tap-zone orientation icon (mini board split) ─────────────────────────

function TapZoneIcon({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  // Small two-cell rectangle hinting at the split direction. Tracks the
  // segmented-toggle's currentColor so it inherits hover / active state.
  if (orientation === 'horizontal') {
    return (
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="7" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <rect x="10" y="1" width="7" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1" y="10" width="12" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

// ── Player roster (add / remove players mid-game) ────────────────────────

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

function PlayerRoster({ game, dispatch }: { game: GameState; dispatch: (a: GameAction) => void }) {
  const players = game.players;
  const isOnline = game.mode === 'online';
  // Roster locks once the game has actually been played — any life
  // adjustment, poison tick, commander-damage hit, or elimination flips
  // it in-progress. Until then it's effectively still in setup and seats
  // can be added or removed.
  const inProgress = players.some(
    (p) =>
      p.life !== game.startingLife ||
      p.poison > 0 ||
      p.eliminated ||
      Object.keys(p.commanderDamage).length > 0
  );
  const canRemove = !inProgress && players.length > MIN_PLAYERS;
  // Add-player is local-only — online seats are claimed by remote players
  // joining via the game code from their own device.
  const canAdd = !isOnline && !inProgress && players.length < MAX_PLAYERS;

  const addPlayer = () => {
    const usedSeats = new Set(players.map((p) => p.seat));
    let nextSeat = 0;
    while (usedSeats.has(nextSeat)) nextSeat += 1;
    const player = makePlayer({
      id: `local_${nextSeat}_${Date.now()}`,
      userId: null,
      seat: nextSeat,
      name: `Player ${nextSeat + 1}`,
      startingLife: game.startingLife,
    });
    dispatch({ type: 'add-player', player });
  };

  return (
    <div className="game-menu-roster" role="group" aria-label="Players">
      <div className="game-menu-roster-grid">
        {players.map((p) => (
          <div key={p.id} className="game-menu-roster-chip">
            <span className="game-menu-roster-name" title={p.name}>
              {p.name}
            </span>
            <button
              type="button"
              className="game-menu-roster-remove"
              aria-label={`Remove ${p.name}`}
              disabled={!canRemove}
              onClick={() => dispatch({ type: 'remove-player', seat: p.seat })}
            >
              ✕
            </button>
          </div>
        ))}
        {!inProgress && canAdd && (
          <button
            type="button"
            className="game-menu-roster-add"
            onClick={addPlayer}
            aria-label="Add player"
          >
            + Add player
          </button>
        )}
      </div>
      {inProgress && (
        <span className="game-menu-roster-locked">
          Roster locks once the game starts. Reset to change seats.
        </span>
      )}
    </div>
  );
}

// ── Layout picker (board arrangement) ────────────────────────────────────

function LayoutPicker({
  total,
  current,
  shared,
  onPick,
  onCustomize,
}: {
  total: number;
  current: GameLayout;
  shared: boolean;
  onPick: (layout: GameLayout) => void;
  onCustomize: () => void;
}) {
  const options = layoutsForCount(total);
  const customActive = isCustomLayout(current);
  return (
    <div className="layout-picker" role="group" aria-label="Board layout">
      <div className="layout-picker-grid">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`layout-option ${current === opt.id ? 'is-selected' : ''}`}
            aria-label={`Layout ${opt.id}`}
            aria-pressed={current === opt.id}
            onClick={() => onPick(opt.id)}
          >
            <LayoutPreview layout={opt} shared={shared} />
          </button>
        ))}
        <button
          type="button"
          className={`layout-option layout-option-custom ${customActive ? 'is-selected' : ''}`}
          aria-pressed={customActive}
          onClick={onCustomize}
        >
          {customActive ? (
            <LayoutPreview layout={resolveLayout(total, current)} shared={shared} />
          ) : (
            <span className="layout-option-custom-glyph" aria-hidden="true">
              ⊞
            </span>
          )}
          <span className="layout-option-custom-label">
            {customActive ? 'Custom · edit' : 'Custom…'}
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Mini board preview rendered from the same BoardLayout the real board
 * uses, so the thumbnail can never disagree with the rendered seats. The
 * preview takes the layout's natural aspect ratio (cols × rows) so a 2×2
 * pod renders as a square, a 4×1 line as a wide bar, a 1×2 facing as a
 * tall stack. Each seat shows a facing arrow (its rotation) so the
 * arrangement — and which way each player reads — is legible at a glance.
 */
function LayoutPreview({ layout, shared }: { layout: BoardLayout; shared: boolean }) {
  const seamTop = 'row' in layout.seam ? (layout.seam.row / layout.rows) * 100 : 50;
  const seamLeft = 'col' in layout.seam ? (layout.seam.col / layout.cols) * 100 : 50;
  return (
    <div
      className="layout-option-preview"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
        aspectRatio: `${layout.cols} / ${layout.rows}`,
        ['--seam-top-pct' as never]: `${seamTop}%`,
        ['--seam-left-pct' as never]: `${seamLeft}%`,
      }}
      aria-hidden="true"
    >
      {layout.seats.map((slot, i) => {
        const rot = shared ? slot.rot : 0;
        const palette = paletteForIndex(i);
        return (
          <span
            key={`seat-${i}`}
            className="layout-option-cell"
            style={{
              gridColumn: slot.colSpan ? `${slot.col} / span ${slot.colSpan}` : `${slot.col}`,
              gridRow: slot.rowSpan ? `${slot.row} / span ${slot.rowSpan}` : `${slot.row}`,
              ['--pp-base' as never]: palette.base,
              ['--pp-edge' as never]: palette.edge,
            }}
          >
            {/* The arrow makes the layout's facing legible at a glance —
                pod (arrows meeting), sides (arrows in from L/R), wide row,
                etc. read as distinct instead of four identical "40"s. */}
            <span className="layout-option-cell-face">
              <FacingArrow rot={rot} />
            </span>
            <span className="layout-option-cell-seat">{i + 1}</span>
          </span>
        );
      })}
      {layout.empty?.map((cell, i) => (
        <span
          key={`empty-${i}`}
          className="layout-option-cell is-empty"
          style={{
            gridColumn: cell.colSpan ? `${cell.col} / span ${cell.colSpan}` : `${cell.col}`,
            gridRow: cell.rowSpan ? `${cell.row} / span ${cell.rowSpan}` : `${cell.row}`,
          }}
        />
      ))}
    </div>
  );
}

// ── Custom layout editor ───────────────────────────────────────────────────

const MAX_EDITOR_ROWS = 6;

/**
 * Tap-first (drag-enhanced) grid editor for arranging seats to match the
 * physical table. Output is serialized into the opaque layout id so it
 * persists + syncs online with no server change. Snaps to a 2-column grid
 * — moves reset spans to 1×1 so overlaps are impossible; width/height are
 * re-applied with the guarded toggles.
 */
function CustomLayoutEditor({
  game,
  onApply,
  onClose,
}: {
  game: GameState;
  onApply: (layout: string) => void;
  onClose: () => void;
}) {
  const count = game.players.length;
  const seed = useMemo(() => resolveLayout(count, game.layout), [count, game.layout]);
  const [rows, setRows] = useState<number>(Math.max(1, Math.min(seed.rows, MAX_EDITOR_ROWS)));
  const [placements, setPlacements] = useState<(Placement | null)[]>(() => {
    const r0 = Math.max(1, Math.min(seed.rows, MAX_EDITOR_ROWS));
    return Array.from({ length: count }, (_, i) => {
      const s = seed.seats[i];
      if (!s) return null;
      const rowSpan = s.rowSpan ?? 1;
      if (s.row + rowSpan - 1 > r0) return null; // doesn't fit the clamped grid
      return {
        col: s.col,
        row: s.row,
        colSpan: s.colSpan ?? 1,
        rowSpan,
        rot: s.rot,
      };
    });
  });
  const [selected, setSelected] = useState<number | null>(null);

  const sensors = useSensors(
    // Small activation distance so a tap selects and only a real drag moves.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const occ = occupancyOf(placements);
  const placedCount = placements.filter(Boolean).length;
  const allPlaced = placedCount === count;

  const placeAt = (seat: number, col: 1 | 2, row: number) => {
    setPlacements((prev) => applyPlacement(prev, seat, col, row));
    setSelected(null);
  };

  const updateSelected = (patch: Partial<Placement>) => {
    if (selected == null) return;
    setPlacements((prev) => prev.map((p, i) => (i === selected && p ? { ...p, ...patch } : p)));
  };

  const sel = selected != null ? placements[selected] : null;
  const canWiden =
    !!sel &&
    sel.col === 1 &&
    sel.colSpan === 1 &&
    rangeFree(occ, 2, sel.row, sel.rowSpan, selected!);
  const canTallen =
    !!sel &&
    sel.rowSpan === 1 &&
    sel.row + 1 <= rows &&
    rangeFreeRows(occ, sel.col, sel.colSpan, sel.row + 1, selected!);

  const onDragEnd = (e: DragEndEvent) => {
    const seat = Number(String(e.active.id).replace('seat-', ''));
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !overId.startsWith('cell-')) return;
    const [, c, r] = overId.split('-');
    placeAt(seat, Number(c) as 1 | 2, Number(r));
  };

  const apply = () => {
    if (!allPlaced) return;
    const seats = placements as Placement[];
    onApply(encodeCustomLayout({ rows, seam: deriveSeam(rows, seats), seats }));
  };

  return (
    <div className="cle-backdrop" role="dialog" aria-label="Custom table layout" onClick={onClose}>
      <div className="cle" onClick={(e) => e.stopPropagation()}>
        <header className="cle-head">
          <span className="cle-title">Custom layout</span>
          <button type="button" className="cle-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="cle-rows">
          <span className="cle-label">Rows</span>
          <div className="play-stepper" role="group" aria-label="Rows">
            <button
              type="button"
              className="play-stepper-btn"
              aria-label="Fewer rows"
              disabled={rows <= 1}
              onClick={() => setRows((n) => Math.max(1, n - 1))}
            >
              −
            </button>
            <span className="play-stepper-value">{rows}</span>
            <button
              type="button"
              className="play-stepper-btn"
              aria-label="More rows"
              disabled={rows >= MAX_EDITOR_ROWS}
              onClick={() => setRows((n) => Math.min(MAX_EDITOR_ROWS, n + 1))}
            >
              +
            </button>
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="cle-grid" style={{ gridTemplateRows: `repeat(${rows}, 1fr)` }}>
            {Array.from({ length: rows }, (_, ri) => ri + 1).flatMap((r) =>
              ([1, 2] as const).map((c) => {
                const owner = occ.get(`${c},${r}`);
                if (owner != null) {
                  const p = placements[owner]!;
                  if (p.col !== c || p.row !== r) return null; // spanned-into cell
                  return (
                    <EditorSeat
                      key={`seat-${owner}`}
                      seat={owner}
                      name={game.players[owner]?.name ?? `Seat ${owner + 1}`}
                      placement={p}
                      selected={selected === owner}
                      onSelect={() => setSelected(selected === owner ? null : owner)}
                    />
                  );
                }
                return (
                  <EditorCell
                    key={`cell-${c}-${r}`}
                    col={c}
                    row={r}
                    armed={selected != null}
                    onTap={() => selected != null && placeAt(selected, c, r)}
                  />
                );
              })
            )}
          </div>
        </DndContext>

        {placedCount < count && (
          <div className="cle-tray" aria-label="Unplaced seats">
            <span className="cle-label">Tap a seat, then a cell</span>
            <div className="cle-tray-chips">
              {placements.map((p, i) =>
                p ? null : (
                  <button
                    key={i}
                    type="button"
                    className={`cle-tray-chip ${selected === i ? 'is-selected' : ''}`}
                    onClick={() => setSelected(selected === i ? null : i)}
                  >
                    {game.players[i]?.name ?? `Seat ${i + 1}`}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {sel && (
          <div className="cle-controls" aria-label="Selected seat">
            <span className="cle-controls-name">
              {game.players[selected!]?.name ?? `Seat ${selected! + 1}`}
            </span>
            <div className="cle-controls-row">
              <button
                type="button"
                className="cle-ctrl"
                onClick={() =>
                  updateSelected({
                    rot: ((sel.rot + 90) % 360) as 0 | 90 | 180 | 270,
                  })
                }
              >
                <FacingArrow rot={sel.rot} /> Rotate
              </button>
              <button
                type="button"
                className="cle-ctrl"
                disabled={sel.colSpan === 1 && !canWiden}
                onClick={() => updateSelected({ colSpan: sel.colSpan === 2 ? 1 : 2 })}
              >
                {sel.colSpan === 2 ? 'Narrow' : 'Wide'}
              </button>
              <button
                type="button"
                className="cle-ctrl"
                disabled={sel.rowSpan === 1 && !canTallen}
                onClick={() => updateSelected({ rowSpan: sel.rowSpan === 2 ? 1 : 2 })}
              >
                {sel.rowSpan === 2 ? 'Short' : 'Tall'}
              </button>
              <button
                type="button"
                className="cle-ctrl is-danger"
                onClick={() => {
                  setPlacements((prev) => prev.map((p, i) => (i === selected ? null : p)));
                  setSelected(null);
                }}
              >
                Unplace
              </button>
            </div>
          </div>
        )}

        <footer className="cle-foot">
          <span className="cle-status">
            {allPlaced ? 'All seats placed' : `${count - placedCount} seat(s) to place`}
          </span>
          <div className="cle-foot-actions">
            <button type="button" className="game-menu-pill" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="game-menu-pill is-primary"
              disabled={!allPlaced}
              onClick={apply}
            >
              Apply layout
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function EditorSeat({
  seat,
  name,
  placement,
  selected,
  onSelect,
}: {
  seat: number;
  name: string;
  placement: Placement;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `seat-${seat}` });
  const palette = paletteForIndex(seat);
  return (
    <div
      ref={setNodeRef}
      className={`cle-seat ${selected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{
        gridColumn: `${placement.col} / span ${placement.colSpan}`,
        gridRow: `${placement.row} / span ${placement.rowSpan}`,
        ['--pp-base' as never]: palette.base,
        ['--pp-edge' as never]: palette.edge,
      }}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      role="button"
      aria-pressed={selected}
      aria-label={`${name} — drag or tap to arrange`}
    >
      <span className="cle-seat-rot">
        <FacingArrow rot={placement.rot} />
      </span>
      <span className="cle-seat-name">{name}</span>
    </div>
  );
}

function EditorCell({
  col,
  row,
  armed,
  onTap,
}: {
  col: 1 | 2;
  row: number;
  armed: boolean;
  onTap: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${col}-${row}` });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`cle-cell ${isOver ? 'is-over' : ''} ${armed ? 'is-armed' : ''}`}
      style={{ gridColumn: col, gridRow: row }}
      onClick={onTap}
      aria-label={`Empty cell column ${col} row ${row}`}
    >
      +
    </button>
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

// ── Win celebration ────────────────────────────────────────────────────────

const CONFETTI_COUNT = 28;

/**
 * Full-board winner moment: a confetti burst plus the winner's name in their
 * own seat color. Dismissable (the game menu / history are still reachable
 * underneath). Resets when a new game's winner is decided because the parent
 * only mounts it while `status === 'finished'` with a winner, and the keyed
 * remount on game id clears the dismissed state.
 */
function WinCelebration({ game }: { game: GameState }) {
  const [dismissed, setDismissed] = useState(false);
  const winner = game.players.find((p) => p.seat === game.winnerSeat);
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

  if (!winner || dismissed) return null;
  return (
    <div
      className="win-celebration"
      role="dialog"
      aria-label={`${winner.name} wins`}
      onClick={() => setDismissed(true)}
    >
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
      <div
        className="win-celebration-card"
        style={palette ? { ['--win-accent' as never]: palette.edge } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="win-celebration-trophy" aria-hidden="true">
          🏆
        </span>
        <span className="win-celebration-name">{winner.name}</span>
        <span className="win-celebration-sub">wins the game</span>
        <button
          type="button"
          className="win-celebration-dismiss"
          onClick={() => setDismissed(true)}
        >
          Continue
        </button>
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
