import { Clock, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignationKind, GameAction, GamePlayer, GameState } from '../../lib/game-state';
import { cmdDamageKey } from '../../lib/game-state';
import { paletteForIndex } from '../../lib/seat-palette';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { useFloatingDelta } from '../../lib/use-floating-delta';
import { haptics } from '../../lib/haptics';
import { capture, clearUndo, peekLabel, popRestore, runSuppressed } from '../../lib/undo-stack';
import { cmdDamageFillRatio, cmdDamageToLethal } from '../../lib/cmd-damage';
import { useTapAndHold } from '../../lib/tap-and-hold';
import { useAuth } from '../../store/auth';
import { usePlayStore } from '../../store/play';
import { GameRecap } from './GameRecap';
import './OnlineGameView.css';

interface Props {
  game: GameState;
  errorMessage?: string | null;
  onEnd?: () => void;
  onLeave?: () => void;
  onRematch?: () => void;
}

/**
 * Per-device online-game surface (T99) — replaces `GameBoard` for online
 * games. Unlike the shared-device board, this is a normal in-page view (no
 * fullscreen overlay, no layouts, no seat rotation): every device is already
 * in front of one player, so there's nothing to re-orient. Server-side
 * own-seat enforcement lands alongside this in the backend lane — this view
 * mirrors that policy client-side so a control that would be rejected never
 * renders in the first place: a player edits only their own life/poison/
 * commander-damage, except host-added guest seats (`userId: null`), which any
 * seated player may adjust.
 */
export function OnlineGameView({ game, errorMessage, onEnd, onLeave, onRematch }: Props) {
  const user = useAuth((s) => s.user);
  const dispatchOnline = usePlayStore((s) => s.dispatchOnline);

  // Wrap dispatch so undoable actions (life/poison/cmd-dmg — see isUndoable)
  // snapshot the pre-action state first; `game` is the live pre-action state
  // on every render, so capture sees the right baseline. Unlike GameBoard
  // there's no `reset`-clears-the-stack branch here — this view never emits
  // a `reset` action, and the leave/end paths already clearUndo via
  // resetOnlineState (store/play.ts).
  const dispatchTracked = useCallback(
    (action: GameAction) => {
      capture(game.id, game, action);
      void dispatchOnline(action);
    },
    [game, dispatchOnline]
  );

  // Undo = compensating actions back to the last snapshot, sent as ONE
  // dispatchOnline batch (not N sequential calls) so the optimistic UI and
  // version handling stay atomic — these are server round-trips, unlike
  // GameBoard's local dispatch. Suppressed so the restore itself isn't
  // captured. `undoNonce` tells LifeControls to drop its floating-delta
  // chip the instant a burst is undone, mirroring GameBoard.
  const [undoNonce, setUndoNonce] = useState(0);
  const undoLabel = game.status !== 'finished' ? peekLabel(game.id) : null;
  const onUndo = useCallback(() => {
    const actions = popRestore(game.id, game);
    if (actions.length === 0) return;
    runSuppressed(() => {
      void dispatchOnline(actions);
    });
    setUndoNonce((n) => n + 1);
    haptics.tap();
  }, [game, dispatchOnline]);

  // Keyboard undo (Cmd/Ctrl+Z) — mirrors GameBoard: skipped while typing in
  // a text-entry surface, only fires when undo is actually available.
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

  // dispatchOnline's failure path (409 version conflict, 403 own-seat
  // rejection, or a thrown-reducer validation error) refetches authoritative
  // server state or otherwise invalidates the optimistic view it was built
  // on. A local undo stack captured against the pre-refetch state could then
  // emit compensations for state the server never actually had, so any
  // reported online error wipes this device's stack rather than risk a wrong
  // restore — the misclick just stops being undoable; the player can still
  // fix it by hand.
  useEffect(() => {
    if (errorMessage) clearUndo(game.id);
  }, [errorMessage, game.id]);

  const mySeat = game.players.find((p) => p.userId === user?.id) ?? null;
  const viewerSeated = mySeat != null;
  const opponents = game.players.filter((p) => p.seat !== mySeat?.seat);
  const activePlayer =
    game.activeSeat != null ? (game.players.find((p) => p.seat === game.activeSeat) ?? null) : null;
  const turnLabel = activePlayer
    ? mySeat && activePlayer.seat === mySeat.seat
      ? 'Your turn'
      : `${activePlayer.name}'s turn`
    : null;

  // Guest seats (host-added, no device of their own) are adjustable by any
  // seated player — everyone else is read-only on a seat that isn't theirs.
  const canEditPlayer = (p: GamePlayer) =>
    p.userId === null ? viewerSeated : p.userId === user?.id;

  return (
    <div className="ogv" data-status={game.status}>
      {errorMessage && (
        <div className="ogv-error" role="alert">
          {errorMessage}
        </div>
      )}

      <header className="ogv-header">
        <div className="ogv-header-main">
          <span className="ogv-code">Game {game.code}</span>
          {game.status === 'lobby' && (
            <span className="ogv-turn ogv-turn-waiting">Waiting to start</span>
          )}
          {turnLabel && (
            <span className="ogv-turn" aria-live="polite">
              <Clock width={14} height={14} strokeWidth={1.8} aria-hidden />
              {turnLabel}
            </span>
          )}
        </div>
        {game.status !== 'finished' && (
          <div className="ogv-header-actions">
            {onEnd && (
              <button type="button" className="btn ogv-header-btn" onClick={onEnd}>
                End
              </button>
            )}
            {onLeave && (
              <button type="button" className="btn ogv-header-btn" onClick={onLeave}>
                Leave
              </button>
            )}
          </div>
        )}
      </header>

      {game.status === 'finished' ? (
        <FinishedPanel game={game} onRematch={onRematch} onLeave={onLeave} />
      ) : (
        <>
          <ul className="ogv-opponents" role="list" aria-label="Opponents">
            {opponents.map((p) => (
              <OpponentTile
                key={p.id}
                player={p}
                game={game}
                dispatch={dispatchTracked}
                editable={canEditPlayer(p)}
                isActiveTurn={game.activeSeat === p.seat}
                undoNonce={undoNonce}
              />
            ))}
          </ul>

          {mySeat ? (
            <YourPanel
              player={mySeat}
              game={game}
              opponents={opponents}
              dispatch={dispatchTracked}
              isActiveTurn={game.activeSeat === mySeat.seat}
              undoNonce={undoNonce}
              onUndo={onUndo}
              undoLabel={undoLabel}
            />
          ) : (
            <div className="ogv-spectator">You&rsquo;re viewing this game without a seat.</div>
          )}
        </>
      )}
    </div>
  );
}

// ── Life readout + controls (shared by your panel and guest tiles) ────────

function LifeControls({
  player,
  dispatch,
  disabled,
  compact = false,
  undoNonce,
}: {
  player: GamePlayer;
  dispatch: (a: GameAction) => void;
  disabled: boolean;
  compact?: boolean;
  /** Bumped on every undo — drops this panel's running-burst chip immediately
   *  instead of leaving it to its normal 1.5s lifetime (mirrors GameBoard). */
  undoNonce?: number;
}) {
  const { display, popKey } = useAnimatedNumber(player.life);
  const { chips, push, clear } = useFloatingDelta();
  const lastChip = chips[chips.length - 1];

  useEffect(() => {
    clear();
  }, [undoNonce, clear]);

  const adjust = (delta: number, skipTap = false) => {
    if (disabled) return;
    dispatch({ type: 'life', seat: player.seat, delta, actorSeat: player.seat });
    push(delta, 50, 50);
    if (!skipTap) haptics.tap();
  };
  const tapHandlers = useTapAndHold({
    onTap: (delta) => adjust(delta),
    onHoldTick: (delta, gearUp) => adjust(delta, gearUp),
    disabled,
  });

  return (
    <div className={`ogv-life ${compact ? 'ogv-life--compact' : 'ogv-life--primary'}`}>
      <button
        type="button"
        className="ogv-life-step"
        aria-label="-1 life"
        disabled={disabled}
        {...tapHandlers(-1)}
      >
        <span aria-hidden="true">−</span>
        {lastChip && lastChip.value < 0 && (
          <span className="ogv-life-step-count">{Math.abs(lastChip.value)}</span>
        )}
      </button>
      <span key={popKey} className="ogv-life-num is-pop" aria-live="polite">
        {display}
      </span>
      <button
        type="button"
        className="ogv-life-step"
        aria-label="+1 life"
        disabled={disabled}
        {...tapHandlers(1)}
      >
        <span aria-hidden="true">+</span>
        {lastChip && lastChip.value > 0 && (
          <span className="ogv-life-step-count">{lastChip.value}</span>
        )}
      </button>
    </div>
  );
}

/** Read-only life number for a seat the viewer can't edit — still animates
 *  so a realtime update from another device reads as motion, not a jump. */
function LifeReadout({ player, lethal }: { player: GamePlayer; lethal: boolean }) {
  const { display, popKey } = useAnimatedNumber(player.life);
  return (
    <span
      key={popKey}
      className={`ogv-life-num is-pop is-readonly ${lethal ? 'is-lethal' : ''}`}
      aria-live="polite"
    >
      {display}
    </span>
  );
}

/** Fires a haptic + a brief flash the moment a seat crosses into lethal
 *  (life ≤ 0, poison ≥ 10, or 21+ commander damage from one source) —
 *  mirrors GameBoard's per-panel lethal-transition effect. */
function useLethalFlash(player: GamePlayer, game: GameState): boolean {
  const [flashing, setFlashing] = useState(false);
  const prevRef = useRef(false);
  useEffect(() => {
    const isLethal =
      player.life <= 0 ||
      (game.poisonEnabled && player.poison >= 10) ||
      (game.commanderDamageEnabled && Object.values(player.commanderDamage).some((v) => v >= 21));
    if (isLethal && !prevRef.current && !player.eliminated) {
      setFlashing(true);
      haptics.lethal();
      const t = setTimeout(() => setFlashing(false), 320);
      prevRef.current = true;
      return () => clearTimeout(t);
    }
    if (!isLethal) prevRef.current = false;
  }, [
    player.life,
    player.poison,
    player.commanderDamage,
    player.eliminated,
    game.poisonEnabled,
    game.commanderDamageEnabled,
  ]);
  return flashing;
}

// ── Opponent tile ───────────────────────────────────────────────────────────

function OpponentTile({
  player,
  game,
  dispatch,
  editable,
  isActiveTurn,
  undoNonce,
}: {
  player: GamePlayer;
  game: GameState;
  dispatch: (a: GameAction) => void;
  editable: boolean;
  isActiveTurn: boolean;
  undoNonce?: number;
}) {
  const palette = paletteForIndex(player.seat);
  const isGuest = player.userId === null;
  const cmdDmgValues = Object.values(player.commanderDamage);
  const maxCmdDmg = cmdDmgValues.length > 0 ? Math.max(...cmdDmgValues) : 0;
  const isCmdLethal = game.commanderDamageEnabled && maxCmdDmg >= 21;
  const isPoisonLethal = game.poisonEnabled && player.poison >= 10;
  const lethal = player.life <= 0 || isCmdLethal || isPoisonLethal;
  const flashing = useLethalFlash(player, game);
  const designations = game.designations ?? { monarch: null, initiative: null };

  const ariaLabel = [
    player.name,
    isGuest && 'guest seat',
    `${player.life} life`,
    isActiveTurn && "this player's turn",
    !player.connected && 'disconnected',
    player.eliminated && 'eliminated',
    game.winnerSeat === player.seat && 'winner',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li
      className={`ogv-opp ${player.eliminated ? 'is-eliminated' : ''} ${
        isActiveTurn ? 'is-active-turn' : ''
      } ${flashing ? 'is-lethal-flash' : ''} ${game.winnerSeat === player.seat ? 'is-winner' : ''}`}
      style={{ ['--ogv-base' as never]: palette.base, ['--ogv-edge' as never]: palette.edge }}
      aria-label={ariaLabel}
    >
      <div className="ogv-opp-head">
        <span className="ogv-opp-dot" aria-hidden="true" />
        <span className="ogv-opp-name" title={player.name}>
          {player.name}
        </span>
        {isGuest && (
          <span className="ogv-badge" title="Guest seat">
            Guest
          </span>
        )}
        {!player.connected && (
          <span className="ogv-badge ogv-badge-offline" title="Disconnected">
            Offline
          </span>
        )}
      </div>

      {editable ? (
        <LifeControls
          player={player}
          dispatch={dispatch}
          disabled={game.status === 'finished'}
          compact
          undoNonce={undoNonce}
        />
      ) : (
        <LifeReadout player={player} lethal={lethal} />
      )}

      <div className="ogv-opp-meta">
        {game.poisonEnabled && (
          <span className={`ogv-chip ${isPoisonLethal ? 'is-lethal' : ''}`}>
            <span aria-hidden="true">☠</span> {player.poison}
          </span>
        )}
        {game.commanderDamageEnabled && (
          <span className={`ogv-chip ${isCmdLethal ? 'is-lethal' : ''}`}>
            <span aria-hidden="true">⚔</span> {maxCmdDmg}
          </span>
        )}
        {designations.monarch === player.seat && (
          <span className="ogv-chip" title="Monarch">
            👑
          </span>
        )}
        {designations.initiative === player.seat && (
          <span className="ogv-chip" title="Initiative">
            🧭
          </span>
        )}
      </div>

      {game.winnerSeat === player.seat && <span className="ogv-opp-tag">Winner</span>}
      {player.eliminated && game.winnerSeat !== player.seat && (
        <span className="ogv-opp-tag ogv-opp-tag-out">Out</span>
      )}
    </li>
  );
}

// ── Your panel ───────────────────────────────────────────────────────────

function YourPanel({
  player,
  game,
  opponents,
  dispatch,
  isActiveTurn,
  undoNonce,
  onUndo,
  undoLabel,
}: {
  player: GamePlayer;
  game: GameState;
  opponents: GamePlayer[];
  dispatch: (a: GameAction) => void;
  isActiveTurn: boolean;
  undoNonce?: number;
  onUndo: () => void;
  undoLabel: string | null;
}) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const disabled = game.status === 'finished' || player.eliminated;
  const designations = game.designations ?? { monarch: null, initiative: null };
  const isMonarch = designations.monarch === player.seat;
  const isInitiative = designations.initiative === player.seat;
  const cmdDmgValues = Object.values(player.commanderDamage);
  const maxCmdDmg = cmdDmgValues.length > 0 ? Math.max(...cmdDmgValues) : 0;
  const flashing = useLethalFlash(player, game);

  const claim = (designation: DesignationKind, held: boolean) => {
    dispatch({
      type: 'set-designation',
      designation,
      seat: held ? null : player.seat,
      actorSeat: player.seat,
    });
  };

  return (
    <section
      className={`ogv-you ${flashing ? 'is-lethal-flash' : ''} ${
        player.eliminated ? 'is-eliminated' : ''
      } ${isActiveTurn ? 'is-active-turn' : ''}`}
      aria-label="Your seat"
    >
      <div className="ogv-you-head">
        <span className="ogv-you-label">You</span>
        <span className="ogv-you-name" title={player.name}>
          {player.name}
        </span>
        {!player.connected && (
          <span className="ogv-badge ogv-badge-offline" title="Disconnected">
            Offline
          </span>
        )}
        {player.eliminated && <span className="ogv-opp-tag ogv-opp-tag-out">Out</span>}
        {undoLabel && (
          <button
            type="button"
            className="ogv-chip-btn ogv-undo-btn"
            aria-label={`Undo ${undoLabel}`}
            title={`Undo ${undoLabel}`}
            onClick={onUndo}
          >
            <Undo2 width={16} height={16} strokeWidth={2.2} aria-hidden />
            Undo
          </button>
        )}
      </div>

      <LifeControls player={player} dispatch={dispatch} disabled={disabled} undoNonce={undoNonce} />

      <div className="ogv-you-tools">
        {game.commanderDamageEnabled && (
          <div className="ogv-tool">
            <button
              type="button"
              className={`ogv-chip-btn ${maxCmdDmg >= 21 ? 'is-lethal' : ''}`}
              aria-expanded={cmdOpen}
              disabled={disabled}
              onClick={() => setCmdOpen((v) => !v)}
            >
              <span aria-hidden="true">⚔</span> Commander damage · {maxCmdDmg}
            </button>
            {cmdOpen && (
              <div className="ogv-cmd-list" role="group" aria-label="Commander damage received">
                {opponents.map((opp) => (
                  <CmdDmgRow
                    key={opp.seat}
                    attacker={opp}
                    mySeat={player.seat}
                    myDamage={player.commanderDamage}
                    dispatch={dispatch}
                    disabled={disabled}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {game.poisonEnabled && (
          <div className="ogv-tool ogv-poison-row">
            <span className="ogv-tool-label">
              <span aria-hidden="true">☠</span> Poison
            </span>
            <div className="ogv-stepper">
              <button
                type="button"
                className="ogv-stepper-btn"
                aria-label="-1 poison"
                disabled={disabled}
                onClick={() =>
                  dispatch({
                    type: 'poison',
                    seat: player.seat,
                    delta: -1,
                    actorSeat: player.seat,
                  })
                }
              >
                −
              </button>
              <span className={`ogv-stepper-value ${player.poison >= 10 ? 'is-lethal' : ''}`}>
                {player.poison}
              </span>
              <button
                type="button"
                className="ogv-stepper-btn"
                aria-label="+1 poison"
                disabled={disabled}
                onClick={() =>
                  dispatch({ type: 'poison', seat: player.seat, delta: 1, actorSeat: player.seat })
                }
              >
                +
              </button>
            </div>
          </div>
        )}

        {game.status === 'active' && !player.eliminated && (
          <div className="ogv-designations">
            <button
              type="button"
              className={`ogv-chip-btn ${isMonarch ? 'is-active' : ''}`}
              aria-pressed={isMonarch}
              onClick={() => claim('monarch', isMonarch)}
            >
              👑 {isMonarch ? 'Monarch' : 'Take Monarch'}
            </button>
            <button
              type="button"
              className={`ogv-chip-btn ${isInitiative ? 'is-active' : ''}`}
              aria-pressed={isInitiative}
              onClick={() => claim('initiative', isInitiative)}
            >
              🧭 {isInitiative ? 'Initiative' : 'Take Initiative'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** One attacker's commander-damage-received row inside the from-seat picker.
 *  Splits into two rows when the attacker has a Partner, mirroring
 *  GameBoard's `.is-cmd-split` panel (rule 903.10a counts to 21 per
 *  commander, never a combined total). */
function CmdDmgRow({
  attacker,
  mySeat,
  myDamage,
  dispatch,
  disabled,
}: {
  attacker: GamePlayer;
  mySeat: number;
  myDamage: Record<string, number>;
  dispatch: (a: GameAction) => void;
  disabled: boolean;
}) {
  const step = (fromPartner: boolean, delta: number) => {
    dispatch({
      type: 'cmd-dmg',
      seat: mySeat,
      fromSeat: attacker.seat,
      fromPartner,
      delta,
      actorSeat: mySeat,
    });
    haptics.tap();
  };
  const primaryValue = myDamage[cmdDamageKey(attacker.seat)] ?? 0;
  const partnerValue = attacker.partner ? (myDamage[cmdDamageKey(attacker.seat, true)] ?? 0) : 0;

  return (
    <div className="ogv-cmd-row-group">
      <CmdDmgHalf
        name={attacker.commander ?? attacker.name}
        value={primaryValue}
        disabled={disabled}
        onStep={(d) => step(false, d)}
      />
      {attacker.partner && (
        <CmdDmgHalf
          name={attacker.partner}
          value={partnerValue}
          disabled={disabled}
          onStep={(d) => step(true, d)}
        />
      )}
    </div>
  );
}

function CmdDmgHalf({
  name,
  value,
  disabled,
  onStep,
}: {
  name: string;
  value: number;
  disabled: boolean;
  onStep: (delta: number) => void;
}) {
  const toLethal = cmdDamageToLethal(value);
  return (
    <div className={`ogv-cmd-row ${value >= 21 ? 'is-lethal' : ''}`}>
      <div
        className="ogv-cmd-row-fill"
        style={{ ['--fill' as never]: cmdDamageFillRatio(value) }}
      />
      <span className="ogv-cmd-row-name" title={name}>
        {name}
      </span>
      <div className="ogv-stepper">
        <button
          type="button"
          className="ogv-stepper-btn"
          aria-label={`-1 commander damage from ${name}`}
          disabled={disabled}
          onClick={() => onStep(-1)}
        >
          −
        </button>
        <span className="ogv-stepper-value">{value}</span>
        <button
          type="button"
          className="ogv-stepper-btn"
          aria-label={`+1 commander damage from ${name}`}
          disabled={disabled}
          onClick={() => onStep(1)}
        >
          +
        </button>
      </div>
      {toLethal !== null && <span className="ogv-cmd-row-hint">{toLethal} to lethal</span>}
    </div>
  );
}

// ── Finished ─────────────────────────────────────────────────────────────

function FinishedPanel({
  game,
  onRematch,
  onLeave,
}: {
  game: GameState;
  onRematch?: () => void;
  onLeave?: () => void;
}) {
  const isDraw = game.winnerSeat == null;
  const winner = isDraw ? undefined : game.players.find((p) => p.seat === game.winnerSeat);

  return (
    <div className="ogv-finished">
      <div className="ogv-finished-banner" role="status">
        {winner ? (
          <>
            <span className="ogv-finished-trophy" aria-hidden="true">
              🏆
            </span>
            <span className="ogv-finished-name">{winner.name}</span>
            <span className="ogv-finished-sub">wins the game</span>
          </>
        ) : (
          <span className="ogv-finished-sub">Game over — no winner</span>
        )}
      </div>
      <GameRecap game={game} />
      <div className="ogv-finished-actions">
        {onRematch && (
          <button type="button" className="btn btn-primary" onClick={onRematch}>
            Rematch — same players
          </button>
        )}
        {onLeave && (
          <button type="button" className="btn" onClick={onLeave}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
