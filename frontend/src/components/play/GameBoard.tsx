import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, GameLayout, GamePlayer, GameState } from '../../lib/game-state';
import type { BoardLayout, SeatSlot } from '../../lib/board-layouts';
import { layoutsForCount, resolveLayout } from '../../lib/board-layouts';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { useFloatingDelta } from '../../lib/use-floating-delta';
import { haptics } from '../../lib/haptics';
import { LifeKeypad } from './LifeKeypad';

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
      </div>

      <button
        type="button"
        className="game-board-menu-btn"
        aria-label="Game menu"
        // Pinned to a corner via CSS so it can't ever overlap a panel's life
        // numeral. Stop pointer events from bubbling so a stray tap-and-hold
        // on the underlying panel doesn't fire.
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
  const disabled = !canEdit || player.eliminated || game.status === 'finished';

  const colorKey = player.panelColorKey
    ? player.panelColorKey.toLowerCase()
    : identityKey(player.colorIdentity);

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

  return (
    <section
      ref={panelRef}
      className={`player-panel pp-color-${colorKey} ${player.eliminated ? 'is-eliminated' : ''} ${
        game.winnerSeat === player.seat ? 'is-winner' : ''
      } ${canEdit ? 'is-mine' : ''} ${lethalFlash ? 'is-lethal-flash' : ''}`}
      // Grid placement comes from the layout registry. Rotation is set as a
      // CSS variable consumed by the .player-panel transform rule so it
      // composes cleanly with any other transforms.
      style={{
        gridColumn: slot.colSpan ? `${slot.col} / span ${slot.colSpan}` : `${slot.col}`,
        gridRow: slot.rowSpan ? `${slot.row} / span ${slot.rowSpan}` : `${slot.row}`,
        ['--pp-rot' as never]: `${rotation}deg`,
      }}
      data-seat={player.seat}
      aria-label={`${player.name}: ${player.life} life`}
    >
      <div className="player-panel-tapzone is-left" {...tapHandlers(-1)} aria-label="-1 life" />
      <div className="player-panel-tapzone is-right" {...tapHandlers(1)} aria-label="+1 life" />

      <div className="player-panel-floats" aria-hidden="true">
        {chips.map((c) => (
          <span
            key={c.id}
            className={`floating-delta ${c.value > 0 ? 'is-positive' : 'is-negative'}`}
            style={{ left: `${c.x}%`, top: `${c.y}%` }}
          >
            {c.value > 0 ? `+${c.value}` : `−${Math.abs(c.value)}`}
          </span>
        ))}
      </div>

      <div className="player-panel-content" aria-hidden="false">
        <header className="player-panel-head">
          <div className="player-panel-name" title={player.name}>
            {player.isHost && (
              <span className="player-panel-host" aria-label="host">
                ★
              </span>
            )}
            {player.name}
            {!player.connected && <span className="player-panel-offline"> · offline</span>}
          </div>
          <button
            type="button"
            className="player-panel-menu-btn"
            aria-label="Seat menu"
            onClick={(e) => {
              e.stopPropagation();
              setSeatMenuOpen((v) => !v);
            }}
          >
            ⋯
          </button>
        </header>

        <div className="player-panel-life-wrap">
          <button
            type="button"
            className="player-panel-step-btn"
            aria-label="-5 life"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              adjust(-5);
            }}
          >
            −5
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
            aria-label="+5 life"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              adjust(5);
            }}
          >
            +5
          </button>
        </div>

        <footer className="player-panel-foot">
          {player.deckName && <div className="player-panel-deck">{player.deckName}</div>}
          {player.commander && <div className="player-panel-commander">{player.commander}</div>}
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
        </footer>
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
                aria-label="Auto (from commander)"
                onClick={() => {
                  dispatch({
                    type: 'update-player',
                    seat: player.seat,
                    patch: { panelColorKey: null },
                  });
                }}
              >
                A
              </button>
            </div>
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
  return (
    <div className="game-menu-backdrop" onClick={onClose}>
      <div className="game-menu" role="dialog" onClick={(e) => e.stopPropagation()}>
        <header className="game-menu-head">
          <span>{game.mode === 'online' ? `Game ${game.code}` : 'Local game'}</span>
          <button type="button" className="game-menu-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="game-menu-body">
          <div className="game-menu-meta">
            <span className="game-menu-format">{game.format}</span>
            <span>Starting life {game.startingLife}</span>
            {game.commanderDamageEnabled && <span>Commander damage</span>}
            {game.poisonEnabled && <span>Poison</span>}
          </div>
          {canControlAll && game.status !== 'finished' && (
            <LayoutPicker
              total={game.players.length}
              current={resolveLayout(game.players.length, game.layout).id}
              shared={game.mode === 'local'}
              onPick={(layout) => dispatch({ type: 'settings', patch: { layout } })}
            />
          )}
          {onMinimize && game.status !== 'finished' && (
            <button
              type="button"
              className="game-menu-action game-menu-action--primary"
              onClick={() => {
                onMinimize();
                onClose();
              }}
            >
              Minimize
              <span className="game-menu-action-hint">Keep the game running — come back later</span>
            </button>
          )}
          {game.status !== 'finished' && (
            <>
              <button
                type="button"
                className="game-menu-action"
                onClick={() => {
                  onEnd?.();
                  onClose();
                }}
              >
                End game
                <span className="game-menu-action-hint">Pick a winner, save to history</span>
              </button>
              {canControlAll && (
                <button
                  type="button"
                  className="game-menu-action"
                  onClick={() => {
                    dispatch({ type: 'reset' });
                    onClose();
                  }}
                >
                  Reset
                  <span className="game-menu-action-hint">Back to starting life, same seats</span>
                </button>
              )}
            </>
          )}
          {onLeave && (
            <button
              type="button"
              className="game-menu-action game-menu-action--danger"
              onClick={() => {
                onLeave();
                onClose();
              }}
            >
              {game.status === 'finished' ? 'Close' : 'Discard game'}
              {game.status !== 'finished' && (
                <span className="game-menu-action-hint">Throw this game away</span>
              )}
            </button>
          )}
          <EventLog game={game} />
        </div>
      </div>
    </div>
  );
}

// ── Layout picker (board arrangement) ────────────────────────────────────

function LayoutPicker({
  total,
  current,
  shared,
  onPick,
}: {
  total: number;
  current: GameLayout;
  shared: boolean;
  onPick: (layout: GameLayout) => void;
}) {
  const options = layoutsForCount(total);
  if (options.length < 2) return null;
  const activeHint = options.find((o) => o.id === current)?.hint ?? options[0].hint;
  return (
    <div className="layout-picker" role="group" aria-label="Board layout">
      <span className="seat-menu-label">Board layout</span>
      <div
        className="layout-picker-grid"
        style={{
          gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, 1fr)`,
        }}
      >
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`layout-option ${current === opt.id ? 'is-selected' : ''}`}
            aria-pressed={current === opt.id}
            onClick={() => onPick(opt.id)}
            title={opt.hint}
          >
            <LayoutPreview layout={opt} shared={shared} />
            <span className="layout-option-label">{opt.label}</span>
          </button>
        ))}
      </div>
      <span className="layout-option-hint">{activeHint}</span>
    </div>
  );
}

/**
 * Mini board preview rendered from the same BoardLayout the real board
 * uses, so the thumbnail can never disagree with the rendered seats. Each
 * cell shows a small orientation bar so flipped vs upright is readable at
 * thumbnail size.
 */
function LayoutPreview({ layout, shared }: { layout: BoardLayout; shared: boolean }) {
  return (
    <div
      className="layout-option-preview"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
      }}
      aria-hidden="true"
    >
      {layout.seats.map((slot, i) => {
        const rot = shared ? slot.rot : 0;
        return (
          <span
            key={i}
            className={`layout-option-cell ${rot === 180 ? 'is-flipped' : ''}`}
            style={{
              gridColumn: slot.colSpan ? `${slot.col} / span ${slot.colSpan}` : `${slot.col}`,
              gridRow: slot.rowSpan ? `${slot.row} / span ${slot.rowSpan}` : `${slot.row}`,
            }}
          />
        );
      })}
    </div>
  );
}

function EventLog({ game }: { game: GameState }) {
  const events = useMemo(() => game.events.slice(-30).reverse(), [game.events]);
  return (
    <details className="game-menu-log">
      <summary>Event log ({game.events.length})</summary>
      <ol className="game-menu-log-list">
        {events.map((ev) => (
          <li key={ev.id} className={`game-menu-log-item kind-${ev.kind}`}>
            <time>{new Date(ev.ts).toLocaleTimeString()}</time>
            <span>{describeEvent(ev, game)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function describeEvent(ev: GameState['events'][number], game: GameState): string {
  const seatName = (seat: number | null | undefined): string => {
    if (seat == null) return '';
    return game.players.find((p) => p.seat === seat)?.name ?? `seat ${seat}`;
  };
  switch (ev.kind) {
    case 'life':
      return `${seatName(ev.targetSeat)} life ${ev.delta && ev.delta > 0 ? '+' : ''}${ev.delta}`;
    case 'set-life':
      return `${seatName(ev.targetSeat)} life set to ${ev.delta}`;
    case 'poison':
      return `${seatName(ev.targetSeat)} poison ${ev.delta && ev.delta > 0 ? '+' : ''}${ev.delta}`;
    case 'cmd-dmg':
      return `${seatName(ev.targetSeat)} cmd dmg ${
        ev.delta && ev.delta > 0 ? '+' : ''
      }${ev.delta} from ${seatName(ev.fromSeat)}`;
    case 'eliminate':
      return `${seatName(ev.targetSeat)} eliminated${ev.message === 'auto' ? ' (auto)' : ''}`;
    case 'revive':
      return `${seatName(ev.targetSeat)} revived`;
    case 'start':
      return 'Game started';
    case 'end':
      return ev.targetSeat != null ? `Game ended — ${seatName(ev.targetSeat)} wins` : 'Game ended';
    case 'reset':
      return 'Game reset';
    case 'join':
      return `${ev.message ?? seatName(ev.targetSeat)} joined`;
    case 'leave':
      return `${ev.message ?? seatName(ev.targetSeat)} left`;
    case 'note':
      return ev.message ?? '';
    case 'settings':
      return 'Settings changed';
    default:
      return ev.kind;
  }
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
