import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, GamePlayer, GameState } from '../../lib/game-state';

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
      className={`game-board game-board-${Math.min(total, 4)} mode-${game.mode}`}
      data-shared={isShared || undefined}
    >
      <div className="game-board-grid">
        {game.players.map((p, i) => (
          <PlayerPanel
            key={p.id}
            player={p}
            game={game}
            dispatch={dispatch}
            rotation={seatRotation(i, total, isShared)}
            canEdit={canControlAll || (viewerUserId != null && p.userId === viewerUserId)}
            opponents={game.players.filter((o) => o.seat !== p.seat)}
          />
        ))}
      </div>

      <button
        type="button"
        className="game-board-menu-btn"
        aria-label="Game menu"
        // Stop pointer events from bubbling to anything beneath — the button
        // sits at the center where four player panels meet, and we don't want
        // a stray tap-and-hold on an adjacent panel to fire just because the
        // pointer was inside this hit area.
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

/**
 * Decide the rotation in degrees for the seat at the given index.
 *
 * Online: never rotate — the viewer holds their own device upright.
 * Local: rotate panels that sit on the far side of the table relative to a
 *   shared phone. 2-player = top half flipped; 4-player = top row flipped.
 *   3-player = both top panels flipped, bottom upright.
 */
function seatRotation(seatIndex: number, total: number, shared: boolean): number {
  if (!shared) return 0;
  if (total === 2) return seatIndex === 0 ? 180 : 0;
  if (total === 3) return seatIndex < 2 ? 180 : 0;
  if (total === 4) return seatIndex < 2 ? 180 : 0;
  return 0;
}

// ── Player panel ───────────────────────────────────────────────────────────

function PlayerPanel({
  player,
  game,
  dispatch,
  rotation,
  canEdit,
  opponents,
}: {
  player: GamePlayer;
  game: GameState;
  dispatch: (a: GameAction) => void;
  rotation: number;
  canEdit: boolean;
  opponents: GamePlayer[];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seatMenuOpen, setSeatMenuOpen] = useState(false);
  const disabled = !canEdit || player.eliminated || game.status === 'finished';

  const colorKey = identityKey(player.colorIdentity);

  // Pressing the tap zones: a single tap = ±1, a long press starts a repeater
  // that fires every 130ms. Releasing (or leaving the zone) stops the repeat.
  const adjust = useCallback(
    (delta: number) => {
      if (disabled) return;
      dispatch({ type: 'life', seat: player.seat, delta, actorSeat: player.seat });
    },
    [disabled, dispatch, player.seat]
  );

  const tapHandlers = useTapAndHold({
    onTap: (delta: number) => adjust(delta),
    onHoldTick: (delta: number) => adjust(delta),
    disabled,
  });

  return (
    <section
      className={`player-panel pp-color-${colorKey} ${player.eliminated ? 'is-eliminated' : ''} ${
        game.winnerSeat === player.seat ? 'is-winner' : ''
      } ${canEdit ? 'is-mine' : ''}`}
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-label={`${player.name}: ${player.life} life`}
    >
      <div className="player-panel-tapzone is-left" {...tapHandlers(-1)} aria-label="-1 life" />
      <div className="player-panel-tapzone is-right" {...tapHandlers(1)} aria-label="+1 life" />

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
          <div className="player-panel-life" aria-live="polite">
            {player.life}
          </div>
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
    </section>
  );
}

// ── Tap & hold ─────────────────────────────────────────────────────────────

interface TapAndHoldOpts {
  onTap: (arg: number) => void;
  onHoldTick: (arg: number) => void;
  disabled: boolean;
}

/**
 * Hook that returns a getHandlers(arg) factory which produces the pointer
 * event handlers for a tap-and-hold zone. A single click fires `onTap(arg)`;
 * a long press (>=350ms) starts a repeater that fires `onHoldTick(arg)` every
 * 130ms until pointer-up or pointer-leave.
 *
 * Using pointer events (not touch/mouse separately) lets the same handler
 * cover mouse, touch, and pen with no synthetic-click double-fire.
 */
function useTapAndHold({ onTap, onHoldTick, disabled }: TapAndHoldOpts) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heldRef = useRef(false);

  const clear = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (repeatTimer.current) clearInterval(repeatTimer.current);
    holdTimer.current = null;
    repeatTimer.current = null;
  };

  useEffect(() => () => clear(), []);

  return (arg: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled) return;
      // Capture the pointer so a drag off the element still fires pointerup
      // on this same node (otherwise the repeater can leak).
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      heldRef.current = false;
      clear();
      holdTimer.current = setTimeout(() => {
        heldRef.current = true;
        onHoldTick(arg);
        repeatTimer.current = setInterval(() => onHoldTick(arg), 130);
      }, 350);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (disabled) return;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      const wasHeld = heldRef.current;
      clear();
      if (!wasHeld) onTap(arg);
    },
    onPointerCancel: () => clear(),
    onPointerLeave: () => clear(),
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
