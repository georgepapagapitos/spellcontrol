import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, GameLayout, GamePlayer, GameState } from '../../lib/game-state';
import { makePlayer } from '../../lib/game-state';
import type { BoardLayout, EmptyCell, SeatSlot } from '../../lib/board-layouts';
import { layoutsForCount, resolveLayout } from '../../lib/board-layouts';
import { paletteForIndex, paletteForSeat } from '../../lib/seat-palette';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { useFloatingDelta } from '../../lib/use-floating-delta';
import { haptics } from '../../lib/haptics';
import { LifeKeypad } from './LifeKeypad';
import { GameHistory } from './GameHistory';
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
 * life, the right half to increment. Press and hold to repeat. Big visible
 * ±5 buttons stay on the edges as a discoverable backup. Commander damage
 * lives in a slide-down drawer so it doesn't crowd the resting view.
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
}: Props) {
  const total = game.players.length;
  const isShared = game.mode === 'local';
  // Resolve to a concrete layout (grid + per-seat slots). Unknown / legacy
  // layout ids fall back to the count's default.
  const board = resolveLayout(total, game.layout);
  const [menuOpen, setMenuOpen] = useState(false);

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
      className={`game-board game-board-${Math.min(total, 6)} layout-${board.id} mode-${game.mode}`}
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
              dispatch={dispatch}
              slot={slot}
              // Rotation only applies in shared (local) mode — on online
              // games each device is in front of its owner, always upright.
              rotation={isShared ? slot.rot : 0}
              canEdit={canControlAll || (viewerUserId != null && p.userId === viewerUserId)}
              opponents={game.players.filter((o) => o.seat !== p.seat)}
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
        <MenuIcon />
      </button>

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
          dispatch={dispatch}
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
  opponents,
}: {
  player: GamePlayer;
  game: GameState;
  dispatch: (a: GameAction) => void;
  slot: SeatSlot;
  rotation: number;
  canEdit: boolean;
  opponents: GamePlayer[];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seatMenuOpen, setSeatMenuOpen] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [lethalFlash, setLethalFlash] = useState(false);
  // Life taps are blocked while any panel overlay is open (seat menu /
  // counters drawer) — otherwise a stray tap on the panel underneath the
  // overlay would change life unexpectedly while the user is picking a
  // color, opening counters, etc.
  const disabled =
    !canEdit || player.eliminated || game.status === 'finished' || seatMenuOpen || drawerOpen;

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
  const { chips, push: pushDelta } = useFloatingDelta();
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
      // Coordinates are in panel-local screen space — but the panel may be
      // rotated 180°. CSS transforms don't affect getBoundingClientRect's
      // axis-aligned box, so for a 180° rotation we flip the offset so the
      // chip lands under the user's actual finger.
      let x = ((clientX - rect.left) / rect.width) * 100;
      let y = ((clientY - rect.top) / rect.height) * 100;
      if (rotation === 180) {
        x = 100 - x;
        y = 100 - y;
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

  const tapHandlers = useTapAndHold({
    onTap: (delta: number) => adjust(delta),
    onHoldTick: (delta: number) => adjust(delta),
    onPointerStart: (e) => recordPointer(e.clientX, e.clientY),
    onPointerMove: (e) => recordPointer(e.clientX, e.clientY),
    onSwipeUp: () => {
      if (!canEdit) return;
      if (game.commanderDamageEnabled || game.poisonEnabled) setDrawerOpen(true);
      else setSeatMenuOpen(true);
    },
    onSwipeDown: () => {
      setDrawerOpen(false);
      setSeatMenuOpen(false);
    },
    rotation,
    disabled,
  });

  const isSideways = rotation === 90 || rotation === 270;
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
        }`}
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
            <div className="player-panel-name" title={player.name}>
              {player.isHost && (
                <span className="player-panel-host" aria-label="host">
                  ★
                </span>
              )}
              <span className="player-panel-name-text">{player.name}</span>
              {!player.connected && <span className="player-panel-offline">offline</span>}
            </div>
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

          {(game.commanderDamageEnabled || game.poisonEnabled) && (
            <button
              type="button"
              className="player-panel-drawer-btn"
              onClick={(e) => {
                e.stopPropagation();
                setDrawerOpen((v) => !v);
              }}
              aria-expanded={drawerOpen}
            >
              Counters {drawerOpen ? '▾' : '▴'}
            </button>
          )}
        </div>

        {drawerOpen && (
          <CountersDrawer
            player={player}
            game={game}
            opponents={opponents}
            disabled={disabled}
            dispatch={dispatch}
            onClose={() => setDrawerOpen(false)}
          />
        )}

        {seatMenuOpen && (
          <SeatMenu
            player={player}
            game={game}
            canEdit={canEdit}
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

// ── Counters drawer (poison + commander damage) ────────────────────────────

function CountersDrawer({
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
    <div className="player-panel-drawer" onClick={(e) => e.stopPropagation()}>
      <div className="player-panel-drawer-head">
        <span className="player-panel-drawer-title">Counters</span>
        <button
          type="button"
          className="player-panel-drawer-close"
          aria-label="Close counters"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="player-panel-drawer-body">
        {game.poisonEnabled && (
          <CounterRow
            label="Poison"
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
              label={`Cmdr · ${o.name}`}
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

function SeatMenu({
  player,
  game,
  canEdit,
  dispatch,
  onClose,
}: {
  player: GamePlayer;
  game: GameState;
  canEdit: boolean;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
}) {
  const [setLifeVal, setSetLifeVal] = useState<string>(String(player.life));
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
}: {
  game: GameState;
  canControlAll: boolean;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
  onMinimize?: () => void;
  onLeave?: () => void;
  onEnd?: () => void;
}) {
  const isFinished = game.status === 'finished';
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
                startingLife={game.startingLife}
                onPick={(layout) => dispatch({ type: 'settings', patch: { layout } })}
              />
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
            <div className="game-menu-actions">
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
  startingLife,
  onPick,
}: {
  total: number;
  current: GameLayout;
  shared: boolean;
  startingLife: number;
  onPick: (layout: GameLayout) => void;
}) {
  const options = layoutsForCount(total);
  if (options.length < 2) return null;
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
            <LayoutPreview layout={opt} shared={shared} startingLife={startingLife} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Mini board preview rendered from the same BoardLayout the real board
 * uses, so the thumbnail can never disagree with the rendered seats. The
 * preview takes the layout's natural aspect ratio (cols × rows) so a 2×2
 * pod renders as a square, a 4×1 line as a wide bar, a 1×2 facing as a
 * tall stack. Each cell shows the starting-life numeral so the picker
 * reads as a true miniature of the board.
 */
function LayoutPreview({
  layout,
  shared,
  startingLife,
}: {
  layout: BoardLayout;
  shared: boolean;
  startingLife: number;
}) {
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
            className={`layout-option-cell ${rot === 180 ? 'is-flipped' : ''}`}
            style={{
              gridColumn: slot.colSpan ? `${slot.col} / span ${slot.colSpan}` : `${slot.col}`,
              gridRow: slot.rowSpan ? `${slot.row} / span ${slot.rowSpan}` : `${slot.row}`,
              ['--pp-base' as never]: palette.base,
              ['--pp-edge' as never]: palette.edge,
            }}
          >
            <span className="layout-option-cell-num">{startingLife}</span>
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

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
