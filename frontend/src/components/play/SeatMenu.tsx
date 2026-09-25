import {
  Compass,
  Crown,
  FastForward,
  Palette,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Skull,
  Swords,
  Trash2,
  Users,
} from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { DesignationKind, GameAction, GamePlayer, GameState } from '../../lib/game-state';
import {
  MAX_COUNTERS_PER_SCOPE,
  MAX_COUNTER_NAME_LENGTH,
  normalizeCounterName,
  seatCounters,
} from '../../lib/game-state';
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
 * Which section a SHORT seat's compact row has swapped in, replacing the row
 * (Done/back returns to it). Irrelevant on a tall seat — the full sheet
 * always shows every section inline regardless of this value.
 */
type EditorKind = 'name' | 'partner' | 'color' | 'facing' | 'counter';

/**
 * A seat's drawer: everything about one seat that isn't its life total.
 *
 * Opened by swiping a seat toward its player (or tapping the seat's name), it
 * slides down over the panel like a shade and leaves a strip of the panel at
 * the player's edge. Tapping the strip, dragging it back up, the ✕ and Esc all
 * close it. It lives inside the rotated panel, so it reads upright for that
 * seat on every layout. This is why a seat carries no buttons of its own: the
 * seat menu, counters cover and corner chips all moved in here (Lotus's model).
 *
 * On a SHORT seat (a container query on `.player-panel-cell`, the same
 * threshold the life keypad already uses) the body becomes ONE horizontally
 * scrolling row — actions, counters as compact steppers, then Name/Partner/
 * Panel color/Panel facing as buttons that swap the row for that one editor.
 * It's the same markup and the same `activeEditor` state either way; a tall
 * seat's CSS just ignores `activeEditor` and shows every section inline, so
 * there is one component, not two trees.
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
}: {
  player: GamePlayer;
  game: GameState;
  canEdit: boolean;
  canLayout: boolean;
  /** Panel rotation composed with the board's own landscape counter-
   *  rotation (if any), so dragging the strip back up is panel-local
   *  regardless of how the device physically turned. */
  rotation: number;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
  /** Enter commander-damage focus for this seat; absent when it's off. */
  onCommanderDamage?: () => void;
  isActiveTurn: boolean;
  isMonarch: boolean;
  isInitiative: boolean;
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
  // Which editor a compact (short-seat) row has swapped in. Meaningless on a
  // tall seat — its CSS shows every section inline regardless.
  const [activeEditor, setActiveEditor] = useState<EditorKind | null>(null);
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
  // (there: horizontal scroll strips; here: vertical). On a compact seat the
  // body scrolls horizontally instead (the row), so this fade is inert there
  // — harmless, since a horizontal scroller never sets these thresholds.
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
  const countersDisabled = !canEdit || player.eliminated || game.status === 'finished';
  const showFacing = canLayout && game.mode === 'local';
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
        <div
          ref={bodyRef}
          className="seat-menu-body"
          data-active-editor={activeEditor ?? undefined}
        >
          {/* Compact row only: the way back from a swapped-in editor to the
              row of chips. CSS-hidden entirely on a tall seat and on a
              compact seat with no editor open. */}
          {activeEditor && (
            <button
              type="button"
              className="seat-menu-editor-back"
              onClick={() => setActiveEditor(null)}
            >
              ‹ Back
            </button>
          )}

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

          <SeatCounters
            player={player}
            game={game}
            disabled={countersDisabled}
            dispatch={dispatch}
            onOpenAdd={() => setActiveEditor('counter')}
          />

          {(canEdit || showFacing) && (
            <div className="seat-menu-triggers" role="group" aria-label="Edit seat">
              {canEdit && (
                <button
                  type="button"
                  className="seat-menu-row-trigger"
                  onClick={() => setActiveEditor('name')}
                >
                  <Pencil width={14} height={14} aria-hidden />
                  <span>Name</span>
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="seat-menu-row-trigger"
                  onClick={() => setActiveEditor('partner')}
                >
                  <Users width={14} height={14} aria-hidden />
                  <span>Partner</span>
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="seat-menu-row-trigger"
                  onClick={() => setActiveEditor('color')}
                >
                  <Palette width={14} height={14} aria-hidden />
                  <span>Color</span>
                </button>
              )}
              {showFacing && (
                <button
                  type="button"
                  className="seat-menu-row-trigger"
                  onClick={() => setActiveEditor('facing')}
                >
                  <RotateCw width={14} height={14} aria-hidden />
                  <span>Facing</span>
                </button>
              )}
            </div>
          )}

          {canEdit && (
            <>
              <div className="seat-menu-divider" aria-hidden="true" />
              <div className="seat-menu-editor" data-editor="name">
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
              </div>
              <div className="seat-menu-editor" data-editor="partner">
                <form
                  className="seat-menu-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const next = partnerTrimmed || null;
                    if (next === (player.partner ?? null)) return;
                    dispatch({
                      type: 'update-player',
                      seat: player.seat,
                      patch: { partner: next },
                    });
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
              </div>
            </>
          )}

          {canEdit && (
            <div className="seat-menu-editor" data-editor="color">
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
            </div>
          )}
          {showFacing && (
            <div className="seat-menu-editor" data-editor="facing">
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

// ── Counters section ────────────────────────────────────────────────────────

/**
 * The seat's counters: poison (if the table uses it) and any free-form
 * counters this seat has. On a tall seat these render as the usual full-width
 * rows; on a compact (short) seat the same rows become narrow vertical
 * steppers that join the drawer's one scrolling row (CSS only — see
 * play-panel-menus.css). "Add a counter" is itself one of the compact row's
 * swappable editors (`data-editor="counter"`), same pattern as Name/Partner/
 * Panel color/Panel facing.
 */
function SeatCounters({
  player,
  game,
  disabled,
  dispatch,
  onOpenAdd,
}: {
  player: GamePlayer;
  game: GameState;
  disabled: boolean;
  dispatch: (a: GameAction) => void;
  /** Compact row only: swap the row for the add-counter form. */
  onOpenAdd: () => void;
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
        {/* Compact row only: the trigger that swaps the row for the form
            below. Tall seats never show it — the form is always inline. */}
        {!disabled && !atCap && (
          <button
            type="button"
            className="seat-menu-row-trigger pp-counters-add-trigger"
            onClick={onOpenAdd}
          >
            <Plus width={14} height={14} aria-hidden />
            <span>Counter</span>
          </button>
        )}
        <div className="seat-menu-editor" data-editor="counter">
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
      </div>
    </section>
  );
}

/**
 * One free-form (or poison) counter row: label + −/value/+, with an optional
 * remove. On a tall seat this is a normal horizontal row; on a compact seat
 * it becomes a narrow vertical stepper (CSS only, play-panel-menus.css).
 */
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
