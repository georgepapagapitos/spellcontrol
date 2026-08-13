import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  DesignationKind,
  GameAction,
  GamePhase,
  GamePlayer,
  GameState,
} from '../../lib/game-state';
import { cmdDamageKey, GAME_PHASES } from '../../lib/game-state';
import type { GameRequest } from '../../lib/games-api';
import { paletteForIndex } from '../../lib/seat-palette';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { useFloatingDelta } from '../../lib/use-floating-delta';
import { haptics } from '../../lib/haptics';
import { cmdDamageFillRatio, cmdDamageToLethal } from '../../lib/cmd-damage';
import { useTapAndHold } from '../../lib/tap-and-hold';
import { useAuth } from '../../store/auth';
import { usePlayStore } from '../../store/play';
import { GameRecap } from './GameRecap';
import './OnlineGameView.css';

const PHASE_LABELS: Record<GamePhase, string> = {
  beginning: 'Beginning',
  main1: 'Main 1',
  combat: 'Combat',
  main2: 'Main 2',
  end: 'End',
};

// Mirrors playtest's TakebackConsentPrompt grace window (see its module doc):
// native long-poll can drop a request's own terminal frame, so the banner
// self-dismisses off the request's own `expiresAt` rather than waiting for a
// server frame that might never arrive.
const HOLD_EXPIRY_GRACE_MS = 2000;

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
  const dispatch = (action: GameAction) => void dispatchOnline(action);
  const onlineRequests = usePlayStore((s) => s.onlineRequests);
  const raiseGameRequest = usePlayStore((s) => s.raiseGameRequest);
  const cancelGameRequest = usePlayStore((s) => s.cancelGameRequest);

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
          {game.status === 'active' && (
            <PhaseChip game={game} mySeat={mySeat} dispatch={dispatch} />
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

      <HoldBanners
        onlineRequests={onlineRequests}
        game={game}
        mySeat={mySeat}
        cancelGameRequest={cancelGameRequest}
      />

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
                dispatch={dispatch}
                editable={canEditPlayer(p)}
                isActiveTurn={game.activeSeat === p.seat}
              />
            ))}
          </ul>

          {mySeat ? (
            <YourPanel
              player={mySeat}
              game={game}
              opponents={opponents}
              dispatch={dispatch}
              isActiveTurn={game.activeSeat === mySeat.seat}
              myRequest={onlineRequests[mySeat.seat]}
              raiseGameRequest={raiseGameRequest}
              cancelGameRequest={cancelGameRequest}
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
}: {
  player: GamePlayer;
  dispatch: (a: GameAction) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  const { display, popKey } = useAnimatedNumber(player.life);
  const { chips, push } = useFloatingDelta();
  const lastChip = chips[chips.length - 1];

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

// ── Phase clock (advisory, T101) ───────────────────────────────────────────

/**
 * Advisory turn-structure clock — a life pad, not a rules engine, so it
 * never blocks anything: it's a chip plus a tap. `game.phase` absent means
 * the clock hasn't been started, and only the active seat's own device gets
 * the (subtle, opt-in) start affordance; every other seat sees nothing at
 * all until it's running. Once running, the phase name is visible to every
 * seat, but only the active seat's own device can advance it — 'end' can't
 * advance further from here, since turn-passing is what resets the clock
 * server-side, not another wrap of this chip.
 */
function PhaseChip({
  game,
  mySeat,
  dispatch,
}: {
  game: GameState;
  mySeat: GamePlayer | null;
  dispatch: (a: GameAction) => void;
}) {
  const phase = game.phase;
  const isActiveOwner = (seat: GamePlayer | null): seat is GamePlayer =>
    seat != null && game.activeSeat === seat.seat;

  if (phase === undefined) {
    if (!isActiveOwner(mySeat)) return null;
    return (
      <button
        type="button"
        className="ogv-phase-start"
        onClick={() => dispatch({ type: 'phase', phase: 'beginning', actorSeat: mySeat.seat })}
      >
        Start the phase clock
      </button>
    );
  }

  const label = PHASE_LABELS[phase];

  if (!isActiveOwner(mySeat)) {
    return (
      <span className="ogv-phase-chip" aria-label={`Phase: ${label}`}>
        <span role="status">{label}</span>
      </span>
    );
  }

  const canAdvance = phase !== 'end';
  const advance = () => {
    const next = GAME_PHASES[GAME_PHASES.indexOf(phase) + 1];
    if (!next) return;
    dispatch({ type: 'phase', phase: next, actorSeat: mySeat.seat });
    haptics.tap();
  };

  return (
    <button
      type="button"
      className="ogv-phase-chip ogv-phase-chip--tappable"
      aria-label={canAdvance ? `Phase: ${label}. Tap to advance.` : `Phase: ${label}`}
      disabled={!canAdvance}
      onClick={advance}
    >
      <span role="status">{label}</span>
    </button>
  );
}

// ── Hold (T101 priority ask) ────────────────────────────────────────────────

/** Every still-live pending hold, any seat, oldest first — mirrors
 *  playtest's TakebackConsentPrompt `pickIncomingRequest`: a `pending` hold
 *  past its `expiresAt` (+ grace) is treated as locally expired so a dropped
 *  terminal frame (native long-poll) can't strand the banner forever. `now`
 *  defaults here rather than at the call site so a render body never calls
 *  the impure `Date.now()` directly. */
function pickPendingHolds(
  onlineRequests: Record<number, GameRequest>,
  now = Date.now()
): GameRequest[] {
  return Object.values(onlineRequests)
    .filter(
      (r) => r.kind === 'hold' && r.status === 'pending' && now - r.expiresAt < HOLD_EXPIRY_GRACE_MS
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Prominent, non-blocking strip for any seat's pending hold — never an
 *  accept/decline surface (holds have no approval machinery at all, see
 *  `GameRequest`'s doc comment), just an announcement plus the holder's own
 *  release control. */
function HoldBanners({
  onlineRequests,
  game,
  mySeat,
  cancelGameRequest,
}: {
  onlineRequests: Record<number, GameRequest>;
  game: GameState;
  mySeat: GamePlayer | null;
  cancelGameRequest: (id: string) => Promise<GameRequest>;
}) {
  const holds = pickPendingHolds(onlineRequests);
  const idsKey = holds.map((h) => h.id).join(',');

  // Self-dismiss at each shown hold's own deadline even with no server frame
  // ever arriving — re-armed only when the shown set of holds changes.
  const [, forceExpiryCheck] = useState(0);
  useEffect(() => {
    if (holds.length === 0) return;
    const soonest = Math.min(...holds.map((h) => h.expiresAt + HOLD_EXPIRY_GRACE_MS - Date.now()));
    const t = setTimeout(() => forceExpiryCheck((n) => n + 1), Math.max(soonest, 0));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Haptic tap when a hold newly lands this session — not for one already
  // pending on first mount, which is a catch-up snapshot, not a landing.
  const seenRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) {
      for (const h of holds) {
        if (!seenRef.current.has(h.id)) haptics.tap();
      }
    }
    for (const h of holds) seenRef.current.add(h.id);
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (holds.length === 0) return null;

  return (
    <div className="ogv-holds">
      {holds.map((h) => (
        <HoldBanner
          key={h.id}
          request={h}
          game={game}
          mine={mySeat != null && h.requesterSeat === mySeat.seat}
          onRelease={() => cancelGameRequest(h.id)}
        />
      ))}
    </div>
  );
}

function HoldBanner({
  request,
  game,
  mine,
  onRelease,
}: {
  request: GameRequest;
  game: GameState;
  mine: boolean;
  onRelease: () => Promise<GameRequest>;
}) {
  const holder = game.players.find((p) => p.seat === request.requesterSeat);
  const palette = paletteForIndex(request.requesterSeat);
  const [releasing, setReleasing] = useState(false);

  const release = async () => {
    setReleasing(true);
    try {
      await onRelease();
    } catch {
      setReleasing(false);
    }
  };

  return (
    <div
      className="ogv-hold"
      role="status"
      style={{ ['--ogv-base' as never]: palette.base, ['--ogv-edge' as never]: palette.edge }}
    >
      <span className="ogv-hold-dot" aria-hidden="true" />
      <span className="ogv-hold-text">
        <strong>{holder?.name ?? 'A player'}</strong> holds — responding…
      </span>
      {mine && (
        <button
          type="button"
          className="ogv-hold-release"
          disabled={releasing}
          onClick={() => void release()}
        >
          {releasing ? 'Releasing…' : 'Release'}
        </button>
      )}
    </div>
  );
}

// ── Opponent tile ───────────────────────────────────────────────────────────

function OpponentTile({
  player,
  game,
  dispatch,
  editable,
  isActiveTurn,
}: {
  player: GamePlayer;
  game: GameState;
  dispatch: (a: GameAction) => void;
  editable: boolean;
  isActiveTurn: boolean;
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
  myRequest,
  raiseGameRequest,
  cancelGameRequest,
}: {
  player: GamePlayer;
  game: GameState;
  opponents: GamePlayer[];
  dispatch: (a: GameAction) => void;
  isActiveTurn: boolean;
  myRequest?: GameRequest;
  raiseGameRequest: (
    kind: GameRequest['kind'],
    payload: GameRequest['payload']
  ) => Promise<GameRequest>;
  cancelGameRequest: (id: string) => Promise<GameRequest>;
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
      </div>

      <LifeControls player={player} dispatch={dispatch} disabled={disabled} />

      <div className="ogv-you-tools">
        <HoldControl
          disabled={disabled}
          myRequest={myRequest}
          raiseGameRequest={raiseGameRequest}
          cancelGameRequest={cancelGameRequest}
        />

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

/** The "Hold" priority ask (T101) — raises or cancels this seat's own hold.
 *  Flips in place to the release control while pending. The server 409s a
 *  second raise while ANY request is already pending for this seat — a
 *  pending takeback ask included, not just a pending hold — so the error is
 *  surfaced inline rather than pre-blocked, and its copy (from the server)
 *  already says a request is pending without claiming which kind. */
function HoldControl({
  disabled,
  myRequest,
  raiseGameRequest,
  cancelGameRequest,
}: {
  disabled: boolean;
  myRequest?: GameRequest;
  raiseGameRequest: (
    kind: GameRequest['kind'],
    payload: GameRequest['payload']
  ) => Promise<GameRequest>;
  cancelGameRequest: (id: string) => Promise<GameRequest>;
}) {
  const pendingHold =
    myRequest?.status === 'pending' && myRequest.kind === 'hold' ? myRequest : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pendingHold) {
        await cancelGameRequest(pendingHold.id);
      } else {
        await raiseGameRequest('hold', { summary: '' });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the table — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ogv-tool">
      <button
        type="button"
        className={`ogv-chip-btn ${pendingHold ? 'is-active' : ''}`}
        aria-pressed={!!pendingHold}
        disabled={disabled || busy}
        onClick={() => void toggle()}
      >
        <span aria-hidden="true">✋</span> {pendingHold ? 'Release hold' : 'Hold'}
      </button>
      {error && (
        <p className="ogv-hold-error" role="alert">
          {error}
        </p>
      )}
    </div>
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
