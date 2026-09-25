import { Compass, Crown, FastForward, Play, Skull, Swords } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { DesignationKind, GameAction, GamePlayer, GameState } from '../../lib/game-state';
import { encodeCustomLayout, resolveLayout, turnOrderOf } from '../../lib/board-layouts';
import { paletteForSeat } from '../../lib/seat-palette';
import { useOverlayDismiss } from '../../lib/use-overlay-dismiss';
import { useTapAndHold } from '../../lib/tap-and-hold';
import { FacingArrow } from './FacingArrow';

// ── Seat drawer ────────────────────────────────────────────────────────────

const FACING_OPTIONS: { rot: 0 | 90 | 180 | 270; label: string }[] = [
  { rot: 0, label: 'Toward you' },
  { rot: 90, label: 'Right' },
  { rot: 180, label: 'Across' },
  { rot: 270, label: 'Left' },
];

/** Same cap the online lobby puts on a guest name. */
const MAX_NAME_LENGTH = 40;

/**
 * A seat's drawer: everything about one seat that isn't its life total.
 *
 * Opened by swiping a seat toward its player (or tapping the seat's name), it
 * slides down over the panel like a shade and leaves a strip of the panel at
 * the player's edge. Tapping the strip, dragging it back up, the ✕ and Esc all
 * close it. It lives inside the rotated panel, so it reads upright for that
 * seat on every layout. This is why a seat carries no buttons of its own: the
 * seat menu, counters cover and corner chips all moved in here (Lotus's model).
 */
export function SeatMenu({
  player,
  game,
  canEdit,
  canLayout,
  rotation,
  dispatch,
  onClose,
  onCommanderDamage,
  isActiveTurn,
  isMonarch,
  isInitiative,
  children,
}: {
  player: GamePlayer;
  game: GameState;
  canEdit: boolean;
  canLayout: boolean;
  /** Panel rotation, so dragging the strip back up is panel-local. */
  rotation: number;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
  /** Enter commander-damage focus for this seat; absent when it's off. */
  onCommanderDamage?: () => void;
  isActiveTurn: boolean;
  isMonarch: boolean;
  isInitiative: boolean;
  /** The seat's counters section, owned by the board. */
  children?: ReactNode;
}) {
  // Rotation is only meaningful in shared (local) play — online each device
  // is already in front of its owner. Changing it converts the current
  // layout into a custom one (persisted in the opaque layout id).
  const current = resolveLayout(game.players.length, game.layout, turnOrderOf(game));
  const currentRot = current.seats[player.seat]?.rot ?? 0;
  // Radios group by shared `name` — one drawer is open at a time, but scope
  // per instance anyway so a second never silently joins this group.
  const panelColorGroup = useId();
  const facingGroup = useId();
  const nameId = useId();
  const partnerId = useId();
  const [nameDraft, setNameDraft] = useState(player.name);
  const [partnerDraft, setPartnerDraft] = useState(player.partner ?? '');
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayDismiss(onClose, panelRef);
  // Only the strip and the header take the drag-to-close: the body scrolls
  // along the same axis, so a swipe there has to stay a scroll.
  const closeSwipe = useTapAndHold({
    onTap: () => {},
    onHoldTick: () => {},
    onSwipeUp: onClose,
    rotation,
    disabled: true,
  });
  // B7-02: the body can genuinely exceed even the biggest panel's height
  // (2-player), so it scrolls — publish which edge(s) still have content
  // behind them, mirroring Tabs.tsx's `data-overflow` fade convention
  // (there: horizontal scroll strips; here: vertical).
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => {
      const max = body.scrollHeight - body.clientHeight;
      let next = 'none';
      if (max > 1) {
        const atTop = body.scrollTop <= 1;
        const atBottom = body.scrollTop >= max - 1;
        next = atTop ? 'bottom' : atBottom ? 'top' : 'both';
      }
      if (body.dataset.overflow !== next) body.dataset.overflow = next;
    };
    update();
    body.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(body);
    return () => {
      body.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [player.seat]);
  const setFacing = (rot: 0 | 90 | 180 | 270) => {
    const seats = current.seats.map((st, i) => (i === player.seat ? { ...st, rot } : st));
    dispatch({
      type: 'settings',
      patch: { layout: encodeCustomLayout({ rows: current.rows, seam: current.seam, seats }) },
    });
  };
  const live = game.status === 'active';
  const inPlay = live && !player.eliminated;
  const designate = (designation: DesignationKind, holds: boolean) =>
    dispatch({
      type: 'set-designation',
      designation,
      seat: holds ? null : player.seat,
      actorSeat: player.seat,
    });
  const nameTrimmed = nameDraft.trim();
  const partnerTrimmed = partnerDraft.trim();
  return (
    <div
      ref={panelRef}
      className="seat-menu"
      role="dialog"
      aria-modal="true"
      aria-label={`Seat menu for ${player.name}`}
    >
      <div className="seat-menu-sheet">
        <header className="seat-menu-head" {...closeSwipe(0)}>
          <span>{player.name}</span>
          <button type="button" className="seat-menu-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div ref={bodyRef} className="seat-menu-body">
          {canEdit && game.status !== 'finished' && (
            <div className="seat-menu-quick" role="group" aria-label="Seat actions">
              {onCommanderDamage && inPlay && (
                <button
                  type="button"
                  className="seat-menu-action"
                  onClick={() => {
                    onClose();
                    onCommanderDamage();
                  }}
                >
                  <Swords width={14} height={14} aria-hidden /> Commander damage
                </button>
              )}
              {inPlay && (
                <button
                  type="button"
                  className={`seat-menu-action ${isActiveTurn ? 'is-active-turn' : ''}`}
                  aria-pressed={isActiveTurn}
                  onClick={() => {
                    // Active seat passes (advance); any other seat TAKES the
                    // turn directly — without toSeat the reducer would advance
                    // from the current holder instead of landing here.
                    dispatch(
                      isActiveTurn
                        ? { type: 'pass-turn', actorSeat: player.seat }
                        : { type: 'pass-turn', actorSeat: player.seat, toSeat: player.seat }
                    );
                    onClose();
                  }}
                >
                  {isActiveTurn ? (
                    <>
                      <FastForward width={14} height={14} aria-hidden /> Pass turn
                    </>
                  ) : (
                    <>
                      <Play width={14} height={14} aria-hidden /> Start turn here
                    </>
                  )}
                </button>
              )}
              {inPlay && (
                <button
                  type="button"
                  className={`seat-menu-action ${isMonarch ? 'is-designation-active' : ''}`}
                  aria-pressed={isMonarch}
                  onClick={() => designate('monarch', isMonarch)}
                >
                  <Crown width={14} height={14} aria-hidden /> Monarch
                </button>
              )}
              {inPlay && (
                <button
                  type="button"
                  className={`seat-menu-action ${isInitiative ? 'is-designation-active' : ''}`}
                  aria-pressed={isInitiative}
                  onClick={() => designate('initiative', isInitiative)}
                >
                  <Compass width={14} height={14} aria-hidden /> Initiative
                </button>
              )}
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
                <Skull width={14} height={14} aria-hidden /> {player.eliminated ? 'Revive' : 'Out'}
              </button>
            </div>
          )}

          {children}

          {canEdit && (
            <>
              <div className="seat-menu-divider" aria-hidden="true" />
              <form
                className="seat-menu-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!nameTrimmed || nameTrimmed === player.name) return;
                  dispatch({
                    type: 'update-player',
                    seat: player.seat,
                    patch: { name: nameTrimmed },
                  });
                }}
              >
                <label className="seat-menu-label" htmlFor={nameId}>
                  Name
                </label>
                <div className="seat-menu-row">
                  <input
                    id={nameId}
                    value={nameDraft}
                    maxLength={MAX_NAME_LENGTH}
                    autoComplete="off"
                    onChange={(e) => setNameDraft(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="pill-btn pill-btn-primary"
                    disabled={!nameTrimmed || nameTrimmed === player.name}
                  >
                    Save
                  </button>
                </div>
              </form>
              <form
                className="seat-menu-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = partnerTrimmed || null;
                  if (next === (player.partner ?? null)) return;
                  dispatch({ type: 'update-player', seat: player.seat, patch: { partner: next } });
                }}
              >
                <label className="seat-menu-label" htmlFor={partnerId}>
                  Partner commander
                </label>
                <div className="seat-menu-row">
                  <input
                    id={partnerId}
                    value={partnerDraft}
                    maxLength={MAX_NAME_LENGTH * 2}
                    autoComplete="off"
                    placeholder="None"
                    onChange={(e) => setPartnerDraft(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="pill-btn pill-btn-primary"
                    disabled={(partnerTrimmed || null) === (player.partner ?? null)}
                  >
                    Save
                  </button>
                </div>
                <span className="seat-menu-color-hint">
                  A partner counts its own commander damage, toward its own 21.
                </span>
              </form>
            </>
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
        </div>
      </div>
      {/* The strip of the seat the shade leaves showing, at the player's edge:
          tap it, or drag it back up, to put the seat back. */}
      <button
        type="button"
        className="seat-menu-strip"
        aria-label={`Close ${player.name}'s seat menu`}
        onClick={onClose}
        {...closeSwipe(0)}
      >
        <span className="seat-menu-grab" aria-hidden="true" />
      </button>
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
