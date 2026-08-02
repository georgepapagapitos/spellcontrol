import { useId, useState } from 'react';
import type { DesignationKind, GameAction, GamePlayer, GameState } from '../../lib/game-state';
import { encodeCustomLayout, resolveLayout } from '../../lib/board-layouts';
import { paletteForSeat } from '../../lib/seat-palette';
import { FacingArrow } from './FacingArrow';

// ── Per-seat menu (concede / set life manually) ───────────────────────────

const FACING_OPTIONS: { rot: 0 | 90 | 180 | 270; label: string }[] = [
  { rot: 0, label: 'Toward you' },
  { rot: 90, label: 'Right' },
  { rot: 180, label: 'Across' },
  { rot: 270, label: 'Left' },
];

export function SeatMenu({
  player,
  game,
  canEdit,
  canLayout,
  dispatch,
  onClose,
  isActiveTurn,
  isMonarch,
  isInitiative,
}: {
  player: GamePlayer;
  game: GameState;
  canEdit: boolean;
  canLayout: boolean;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
  isActiveTurn: boolean;
  isMonarch: boolean;
  isInitiative: boolean;
}) {
  const [setLifeVal, setSetLifeVal] = useState<string>(String(player.life));
  // Rotation is only meaningful in shared (local) play — online each device
  // is already in front of its owner. Changing it converts the current
  // layout into a custom one (persisted in the opaque layout id).
  const current = resolveLayout(game.players.length, game.layout);
  const currentRot = current.seats[player.seat]?.rot ?? 0;
  // Radios group by shared `name` — one seat menu is open at a time, but scope
  // per instance anyway so a second never silently joins this group.
  const panelColorGroup = useId();
  const facingGroup = useId();
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
            {/* Native radios: exclusivity + arrow-key nav + one group tab stop.
                "Seat default" is one of the mutually exclusive values (the null
                key), so it belongs in the group rather than beside it. */}
            <fieldset className="seat-menu-swatches" aria-label="Panel color">
              {(['W', 'U', 'B', 'R', 'G', 'M', 'C'] as const).map((k) => (
                <label
                  key={k}
                  className={`seat-menu-swatch pp-color-${k.toLowerCase()} ${
                    player.panelColorKey === k ? 'is-selected' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name={panelColorGroup}
                    value={k}
                    checked={player.panelColorKey === k}
                    aria-label={SWATCH_LABEL[k]}
                    onChange={() => {
                      dispatch({
                        type: 'update-player',
                        seat: player.seat,
                        patch: { panelColorKey: k },
                      });
                    }}
                  />
                </label>
              ))}
              <label
                className={`seat-menu-swatch is-auto ${
                  player.panelColorKey === null ? 'is-selected' : ''
                }`}
                style={{
                  ['--pp-base' as never]: paletteForSeat(game.id, player.seat).base,
                  ['--pp-edge' as never]: paletteForSeat(game.id, player.seat).edge,
                }}
                title="Seat default"
              >
                <input
                  type="radio"
                  name={panelColorGroup}
                  value="auto"
                  checked={player.panelColorKey === null}
                  aria-label="Seat default (auto from commander color identity)"
                  onChange={() => {
                    dispatch({
                      type: 'update-player',
                      seat: player.seat,
                      patch: { panelColorKey: null },
                    });
                  }}
                />
              </label>
            </fieldset>
            <span className="seat-menu-color-hint">
              Seat default uses your deck&apos;s color identity, or your seat color if none.
            </span>
          </div>
        )}
        {canLayout && game.mode === 'local' && (
          <div className="seat-menu-facing">
            <span className="seat-menu-label">Panel facing</span>
            <fieldset className="seat-menu-facing-row" aria-label="Panel facing">
              {FACING_OPTIONS.map((opt) => (
                <label
                  key={opt.rot}
                  title={opt.label}
                  className={`seat-menu-facing-btn ${currentRot === opt.rot ? 'is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name={facingGroup}
                    value={opt.rot}
                    checked={currentRot === opt.rot}
                    aria-label={opt.label}
                    onChange={() => setFacing(opt.rot)}
                  />
                  <FacingArrow rot={opt.rot} />
                </label>
              ))}
            </fieldset>
            <span className="seat-menu-color-hint">
              Rotate this seat so the player reads it upright from their chair.
            </span>
          </div>
        )}
        {canEdit && game.status !== 'finished' && (
          <>
            <div className="seat-menu-divider" aria-hidden="true" />
            <button
              type="button"
              className={`seat-menu-action ${!player.eliminated ? 'is-danger' : ''}`}
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
          </>
        )}

        {/* Turn tracking — only shown while the game is active */}
        {game.status === 'active' && !player.eliminated && (
          <div className="seat-menu-turn-section">
            <span className="seat-menu-label">Turn</span>
            <button
              type="button"
              className={`seat-menu-action ${isActiveTurn ? 'is-active-turn' : ''}`}
              aria-pressed={isActiveTurn}
              onClick={() => {
                // Active seat passes (advance); any other seat TAKES the turn
                // directly — without toSeat the reducer would advance from the
                // current holder instead of landing here.
                dispatch(
                  isActiveTurn
                    ? { type: 'pass-turn', actorSeat: player.seat }
                    : { type: 'pass-turn', actorSeat: player.seat, toSeat: player.seat }
                );
                onClose();
              }}
            >
              {isActiveTurn ? '⏩ Pass turn' : '▶ Start turn here'}
            </button>
          </div>
        )}

        {/* Divider + table designations — shown while game is active; any
            participant can claim/clear them (host-or-all gate is the same as
            life changes). Text labels carry the full meaning. */}
        {game.status === 'active' && !player.eliminated && (
          <>
            <div className="seat-menu-divider" aria-hidden="true" />
            <div className="seat-menu-designations">
              <span className="seat-menu-label">Designations</span>
              <button
                type="button"
                className={`seat-menu-action ${isMonarch ? 'is-designation-active' : ''}`}
                aria-pressed={isMonarch}
                onClick={() => {
                  dispatch({
                    type: 'set-designation',
                    designation: 'monarch' as DesignationKind,
                    seat: isMonarch ? null : player.seat,
                    actorSeat: player.seat,
                  });
                  onClose();
                }}
              >
                {isMonarch ? '👑 Remove Monarch' : '👑 Take Monarch'}
              </button>
              <button
                type="button"
                className={`seat-menu-action ${isInitiative ? 'is-designation-active' : ''}`}
                aria-pressed={isInitiative}
                onClick={() => {
                  dispatch({
                    type: 'set-designation',
                    designation: 'initiative' as DesignationKind,
                    seat: isInitiative ? null : player.seat,
                    actorSeat: player.seat,
                  });
                  onClose();
                }}
              >
                {isInitiative ? '🧭 Remove Initiative' : '🧭 Take Initiative'}
              </button>
            </div>
          </>
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
