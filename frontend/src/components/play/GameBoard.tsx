import { useMemo, useState } from 'react';
import type { GameAction, GamePlayer, GameState } from '../../lib/game-state';

interface Props {
  game: GameState;
  /** Apply an action to the underlying store. */
  dispatch: (action: GameAction) => void;
  /** True if the viewing user controls every seat (local) or is the host (online). */
  canControlAll: boolean;
  /** Authed user id, for online games. Used to gate per-seat controls. */
  viewerUserId?: string | null;
  /** Called when the user requests to end the game. */
  onEnd?: () => void;
  /** Called when the user requests to leave/reset/discard. */
  onLeave?: () => void;
  /** Banner shown above the board (e.g. join code). */
  banner?: React.ReactNode;
  /** Error to show inline (online only). */
  errorMessage?: string | null;
}

/**
 * Visual rotation per seat so each player reads upright when sitting around a
 * table. 2p = head-to-head (180°), 3p = top-row mirror + bottom upright,
 * 4p = corners facing outward. Online mode does not rotate — every viewer is
 * looking at their own device and wants their own seat upright; opponent
 * seats display upright too since the device isn't physically shared.
 */
function seatRotation(seatIndex: number, totalSeats: number, shared: boolean): number {
  if (!shared) return 0;
  if (totalSeats <= 1) return 0;
  if (totalSeats === 2) return seatIndex === 0 ? 180 : 0;
  if (totalSeats === 3) {
    // Two rotated panels across the top, one upright at the bottom.
    if (seatIndex === 0) return 180;
    if (seatIndex === 1) return 180;
    return 0;
  }
  // 4+ players: rotate top row 180°, leave bottom row upright.
  const half = Math.ceil(totalSeats / 2);
  return seatIndex < half ? 180 : 0;
}

export function GameBoard({
  game,
  dispatch,
  canControlAll,
  viewerUserId,
  onEnd,
  onLeave,
  banner,
  errorMessage,
}: Props) {
  const total = game.players.length;
  const isShared = game.mode === 'local';

  return (
    <div className="play-board" data-mode={game.mode} data-players={total}>
      {banner}
      {errorMessage && <div className="play-board-error">{errorMessage}</div>}
      <div className={`play-seats play-seats-${Math.min(total, 4)}`}>
        {game.players.map((p, i) => (
          <SeatPanel
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
      <div className="play-toolbar">
        <div className="play-toolbar-meta">
          <span className="play-toolbar-format">{game.format}</span>
          <span className="play-toolbar-dot">·</span>
          <span>Starting life {game.startingLife}</span>
          {game.commanderDamageEnabled && (
            <>
              <span className="play-toolbar-dot">·</span>
              <span>Cmd dmg</span>
            </>
          )}
          {game.poisonEnabled && (
            <>
              <span className="play-toolbar-dot">·</span>
              <span>Poison</span>
            </>
          )}
        </div>
        <div className="play-toolbar-actions">
          {canControlAll && game.status !== 'finished' && (
            <button type="button" className="pill-btn" onClick={() => dispatch({ type: 'reset' })}>
              Reset
            </button>
          )}
          {game.status !== 'finished' && (
            <button type="button" className="pill-btn pill-btn-primary" onClick={onEnd}>
              End game
            </button>
          )}
          {onLeave && (
            <button type="button" className="pill-btn pill-btn-danger" onClick={onLeave}>
              {game.status === 'finished' ? 'Close' : 'Leave'}
            </button>
          )}
        </div>
      </div>
      <EventLog game={game} />
    </div>
  );
}

function SeatPanel({
  player,
  game,
  dispatch,
  rotation,
  canEdit,
  opponents,
}: {
  player: GamePlayer;
  game: GameState;
  dispatch: (action: GameAction) => void;
  rotation: number;
  canEdit: boolean;
  opponents: GamePlayer[];
}) {
  const [showCmdDmg, setShowCmdDmg] = useState(false);
  const lifeButtonsDisabled = !canEdit || player.eliminated || game.status === 'finished';

  return (
    <section
      className={`play-seat ${player.eliminated ? 'is-eliminated' : ''} ${
        game.winnerSeat === player.seat ? 'is-winner' : ''
      } ${canEdit ? 'is-mine' : ''}`}
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-label={`${player.name}: ${player.life} life`}
    >
      <header className="play-seat-head">
        <div className="play-seat-name" title={player.name}>
          {player.isHost && (
            <span className="play-seat-host" aria-label="host">
              ★
            </span>
          )}
          {player.name}
          {!player.connected && <span className="play-seat-offline"> (offline)</span>}
        </div>
        {player.deckName && <div className="play-seat-deck">{player.deckName}</div>}
        {player.commander && <div className="play-seat-commander">{player.commander}</div>}
      </header>
      <div className="play-seat-life-row">
        <button
          type="button"
          className="play-life-btn play-life-btn--big"
          aria-label="-5 life"
          disabled={lifeButtonsDisabled}
          onClick={() =>
            dispatch({ type: 'life', seat: player.seat, delta: -5, actorSeat: player.seat })
          }
        >
          −5
        </button>
        <button
          type="button"
          className="play-life-btn"
          aria-label="-1 life"
          disabled={lifeButtonsDisabled}
          onClick={() =>
            dispatch({ type: 'life', seat: player.seat, delta: -1, actorSeat: player.seat })
          }
        >
          −1
        </button>
        <div className="play-seat-life" aria-live="polite">
          {player.life}
        </div>
        <button
          type="button"
          className="play-life-btn"
          aria-label="+1 life"
          disabled={lifeButtonsDisabled}
          onClick={() =>
            dispatch({ type: 'life', seat: player.seat, delta: 1, actorSeat: player.seat })
          }
        >
          +1
        </button>
        <button
          type="button"
          className="play-life-btn play-life-btn--big"
          aria-label="+5 life"
          disabled={lifeButtonsDisabled}
          onClick={() =>
            dispatch({ type: 'life', seat: player.seat, delta: 5, actorSeat: player.seat })
          }
        >
          +5
        </button>
      </div>
      <div className="play-seat-counters">
        {game.poisonEnabled && (
          <div className="play-counter">
            <span className="play-counter-label">Poison</span>
            <button
              type="button"
              className="play-counter-btn"
              aria-label="-1 poison"
              disabled={lifeButtonsDisabled}
              onClick={() =>
                dispatch({ type: 'poison', seat: player.seat, delta: -1, actorSeat: player.seat })
              }
            >
              −
            </button>
            <span className="play-counter-value">{player.poison}</span>
            <button
              type="button"
              className="play-counter-btn"
              aria-label="+1 poison"
              disabled={lifeButtonsDisabled}
              onClick={() =>
                dispatch({ type: 'poison', seat: player.seat, delta: 1, actorSeat: player.seat })
              }
            >
              +
            </button>
          </div>
        )}
        {game.commanderDamageEnabled && opponents.length > 0 && (
          <button
            type="button"
            className="play-counter-toggle"
            onClick={() => setShowCmdDmg((v) => !v)}
            aria-expanded={showCmdDmg}
          >
            Commander dmg {showCmdDmg ? '▴' : '▾'}
          </button>
        )}
      </div>
      {game.commanderDamageEnabled && showCmdDmg && (
        <div className="play-cmd-grid">
          {opponents.map((o) => {
            const dmg = player.commanderDamage[o.seat] ?? 0;
            return (
              <div key={o.seat} className={`play-cmd-cell ${dmg >= 21 ? 'is-lethal' : ''}`}>
                <span className="play-cmd-cell-from">from {o.name}</span>
                <div className="play-cmd-cell-controls">
                  <button
                    type="button"
                    className="play-counter-btn"
                    aria-label={`-1 commander damage from ${o.name}`}
                    disabled={lifeButtonsDisabled}
                    onClick={() =>
                      dispatch({
                        type: 'cmd-dmg',
                        seat: player.seat,
                        fromSeat: o.seat,
                        delta: -1,
                        actorSeat: player.seat,
                      })
                    }
                  >
                    −
                  </button>
                  <span className="play-cmd-cell-value">{dmg}</span>
                  <button
                    type="button"
                    className="play-counter-btn"
                    aria-label={`+1 commander damage from ${o.name}`}
                    disabled={lifeButtonsDisabled}
                    onClick={() =>
                      dispatch({
                        type: 'cmd-dmg',
                        seat: player.seat,
                        fromSeat: o.seat,
                        delta: 1,
                        actorSeat: player.seat,
                      })
                    }
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {canEdit && game.status !== 'finished' && (
        <button
          type="button"
          className="play-seat-eliminate"
          onClick={() =>
            dispatch({ type: 'eliminate', seat: player.seat, eliminated: !player.eliminated })
          }
        >
          {player.eliminated ? 'Revive' : 'Concede'}
        </button>
      )}
    </section>
  );
}

function EventLog({ game }: { game: GameState }) {
  const [open, setOpen] = useState(false);
  const events = useMemo(() => game.events.slice(-30).reverse(), [game.events]);
  return (
    <details
      className="play-log"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>Event log ({game.events.length})</summary>
      <ol className="play-log-list">
        {events.map((ev) => (
          <li key={ev.id} className={`play-log-item kind-${ev.kind}`}>
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
