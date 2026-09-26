import { Check, Copy, Crown, Shuffle, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { SelectMenu } from '../SelectMenu';
import { VisibilityChoice } from '../VisibilityChoice';
import { DeckPicker, SeatPips, Stepper } from './SetupControls';
import type { PickedDeck } from './DeckPickerDialog';
import { deckBoardPath, starterFileName } from '../../lib/starter-decks';
import { FORMAT_OPTIONS } from '../../lib/game-formats';
import { pickFirstPlayer } from '../../lib/game-tools';
import { useCardThumb } from '../../lib/card-thumbs';
import { effectiveBracket, type Deck } from '../../store/decks';
import { bracketTextWithEstimate } from '../../lib/format-bracket-label';
import type {
  GameAction,
  GameEvent,
  GameFormat,
  GamePlayer,
  GameState,
  HordeTable as HordeTableState,
  MulliganType,
} from '../../lib/game-state';
import { makePlayer, MAX_ONLINE_SEATS, HORDE_MAX_SEATS } from '../../lib/game-state';
import { ColorPip } from '../shared/ManaSymbol';
import { HordeSetupFields, levelSummary } from './horde/HordeSetupFields';
import {
  HORDE_CATALOG,
  loadHordeDeck,
  resolveHordeSettings,
  type HordeLevel,
  type HordeSettings,
} from '@/lib/horde';
import { findBannedCards, type HordeBanWarning } from '@/lib/horde/ban-list';
import { useStarterDeckCardNames } from '@/lib/horde/starter-deck-cards';
import './OnlineLobby.css';
import { Button } from '@/components/shared/Button';

/** Same cap as the create/join paths and the local setup's seat names. */
const MAX_GUEST_NAME = 40;

/** The three mulligan variants, said the way a pod says them. Order is
 *  commonest first: Commander tables play the free-first rule by default. */
const MULLIGAN_OPTIONS: { value: MulliganType; label: string }[] = [
  { value: 'commander', label: 'Commander (first is free)' },
  { value: 'london', label: 'London' },
  { value: 'free', label: 'Free' },
];

/** The starting-player select's "nobody yet" value. A real seat number can
 *  never collide with it, and null is not a select value. */
const RANDOM_SEAT = 'random';

/** Seats an online table shows before anyone joins. The server seats up to
 *  MAX_ONLINE_SEATS; a pod is four, so four is what the grid promises and it
 *  grows from there. */
const MIN_SEATS = 4;
const MAX_CHAT_LEN = 240;

/** Chat and system lines share one feed, newest last. */
const FEED_KINDS = new Set<GameEvent['kind']>(['note', 'join', 'leave']);

interface Props {
  game: GameState;
  decks: Deck[];
  userId: string | null;
  mySeat: GamePlayer;
  errorMessage?: string | null;
  // Horde's Start sends `horde-setup` and `start` in one batch (design point
  // 6), so the array form has to reach the store's own batching dispatch.
  dispatch: (action: GameAction | GameAction[]) => void;
  onLeave: () => void;
}

type HordeDeckLoad =
  | { id: string; status: 'loading' }
  | { id: string; status: 'loaded'; rev: string }
  | { id: string; status: 'error' };

/** Lazily loads a horde's deck for its `rev` (design point 2/6), re-fetched
 *  on `retry()` after a failure. Never touches the offline
 *  `useHordeGameStore`: that store drives a Local Horde fight, and an online
 *  table's horde lives in `GameState` instead.
 *
 *  "Loading" is derived, never set: the effect only calls `setState` from its
 *  async callbacks (the settled result), so a fresh `hordeId` or `retry()`
 *  reads as loading purely because the settled record no longer matches the
 *  current id/token — no synchronous setState in the effect body itself. */
function useHordeDeckLoad(hordeId: string): HordeDeckLoad & { retry(): void } {
  const [retryToken, setRetryToken] = useState(0);
  const [settled, setSettled] = useState<
    | ({ id: string; token: number } & ({ status: 'loaded'; rev: string } | { status: 'error' }))
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    loadHordeDeck(hordeId)
      .then((def) => {
        if (!cancelled)
          setSettled({ id: hordeId, token: retryToken, status: 'loaded', rev: def.rev });
      })
      .catch(() => {
        if (!cancelled) setSettled({ id: hordeId, token: retryToken, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [hordeId, retryToken]);

  const retry = () => setRetryToken((n) => n + 1);
  if (!settled || settled.id !== hordeId || settled.token !== retryToken) {
    return { id: hordeId, status: 'loading', retry };
  }
  if (settled.status === 'loaded')
    return { id: hordeId, status: 'loaded', rev: settled.rev, retry };
  return { id: hordeId, status: 'error', retry };
}

/**
 * The seated pre-start table: settings and chat down one rail, the seats
 * themselves as the page's subject, and the things you do before a game
 * starts (pick a deck, say you're ready, start, leave) on one bar at the
 * bottom. Replaces the old lobby, which was the live game board with a
 * "Start game" button bolted into its header — the board answers "what is
 * everyone's life total", a question nobody has yet.
 *
 * Only the settings the reducer can actually honour are here. Everything a
 * rules engine would be needed for (mulligan style, sideboards, a turn
 * timer) is deliberately absent rather than faked: this is a life pad with a
 * shared log, and a toggle that changes nothing is worse than no toggle.
 */
export function OnlineLobby({
  game,
  decks,
  userId,
  mySeat,
  errorMessage,
  dispatch,
  onLeave,
}: Props) {
  const isHost = game.hostUserId != null && game.hostUserId === userId;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const isHordeFormat = game.format === 'horde';

  const seats: Array<GamePlayer | null> = useMemo(() => {
    const cap = isHordeFormat ? HORDE_MAX_SEATS : MAX_ONLINE_SEATS;
    const count = Math.min(cap, Math.max(MIN_SEATS, game.players.length));
    return Array.from({ length: count }, (_, i) => game.players.find((p) => p.seat === i) ?? null);
  }, [game.players, isHordeFormat]);

  // A guest seat has no device to press "I'm ready" on; the host who seated
  // them vouches for it, so it never holds the count up.
  const readyCount = game.players.filter((p) => p.ready === true || p.userId === null).length;
  const allReady = readyCount === game.players.length;
  const myDeck = mySeat.deckId ? (decks.find((d) => d.id === mySeat.deckId) ?? null) : null;

  // ── Horde: the host's pick, synced as table state (design point 2) ────────
  const seatedCount = game.players.length;
  const [hordeId, setHordeId] = useState<string>(HORDE_CATALOG[0].id);
  const [hordeLevel, setHordeLevel] = useState<HordeLevel>('standard');
  const [hordeCustomiseOpen, setHordeCustomiseOpen] = useState(false);
  // Customise overrides never travel with the table — a host reload falls
  // back to the preset, which is fine (see design point 2).
  const [hordeOverrides, setHordeOverrides] = useState<Partial<HordeSettings>>({});
  const hordeDeck = useHordeDeckLoad(hordeId);

  // Own seat only (design point 5) — reused for both the host's
  // HordeSetupFields and the joiner's read-only strip below.
  const myStarterFile =
    isHordeFormat && mySeat.deckId && !myDeck ? starterFileName(mySeat.deckId) : null;
  const myStarterNames = useStarterDeckCardNames(myStarterFile ? [myStarterFile] : []);
  const hordeOwnWarnings = useMemo<HordeBanWarning[]>(() => {
    if (!isHordeFormat) return [];
    const cardNames = myDeck
      ? [
          myDeck.commander?.name,
          myDeck.partnerCommander?.name,
          ...myDeck.cards.map((c) => c.card.name),
        ].filter((n): n is string => Boolean(n))
      : ((myStarterFile ? myStarterNames.get(myStarterFile) : undefined) ?? []);
    return findBannedCards([{ name: mySeat.name, cardNames }]);
  }, [isHordeFormat, myDeck, myStarterFile, myStarterNames, mySeat.name]);

  // Dispatch on the latest handler without making it an effect dependency —
  // the prop is a fresh closure every render (see PlayPage's `dispatch={...}`),
  // and putting it in the array below would reset the debounce on every
  // unrelated re-render instead of only on a real pick change.
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  });

  // The host's device publishes the pick to the table whenever it changes,
  // or whenever the seated count changes (the numbers follow the survivors),
  // debounced so a Stepper drag doesn't spam the table with settings.
  const hordeDeckRev = hordeDeck.status === 'loaded' ? hordeDeck.rev : undefined;
  useEffect(() => {
    if (!isHost || !isHordeFormat) return;
    if (hordeDeck.status !== 'loaded' || hordeDeck.id !== hordeId || hordeDeckRev == null) return;
    const settings = resolveHordeSettings(hordeLevel, seatedCount, hordeOverrides);
    const rev = hordeDeckRev;
    const timer = window.setTimeout(() => {
      dispatchRef.current({
        type: 'horde-setup',
        hordeId,
        level: hordeLevel,
        settings,
        // Any value here — Start re-rolls it for the actual game.
        seed: 0,
        deckRev: rev,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    isHost,
    isHordeFormat,
    hordeId,
    hordeLevel,
    hordeOverrides,
    seatedCount,
    hordeDeck.status,
    hordeDeck.id,
    hordeDeckRev,
  ]);

  const pickDeck = (picked: PickedDeck | null) =>
    dispatch({
      type: 'update-player',
      seat: mySeat.seat,
      patch: {
        deckId: picked?.id ?? null,
        deckName: picked?.name ?? null,
        commander: picked?.commander ?? null,
        partner: picked?.partner ?? null,
        colorIdentity: picked?.colorIdentity ?? [],
        bracket: picked?.bracket ?? null,
      },
    });

  return (
    <div className="lobby">
      {errorMessage && (
        <div className="ogv-error" role="alert">
          {errorMessage}
        </div>
      )}

      <div className="lobby-body">
        <LobbyRail game={game} isHost={isHost} mySeat={mySeat} dispatch={dispatch} />

        <div className="lobby-main">
          <h2 className="lobby-title">
            {game.name ? game.name : `${formatLabel(game.format)} table`}
          </h2>

          {isHordeFormat && (
            <section className="lobby-horde" aria-labelledby="lobby-horde-label">
              <h3 className="lobby-section-label" id="lobby-horde-label">
                The horde
              </h3>
              {isHost ? (
                <>
                  <HordeSetupFields
                    hordeId={hordeId}
                    onHordeChange={setHordeId}
                    level={hordeLevel}
                    onLevelChange={setHordeLevel}
                    survivorCount={seatedCount}
                    customiseOpen={hordeCustomiseOpen}
                    onToggleCustomise={() => setHordeCustomiseOpen((v) => !v)}
                    overrides={hordeOverrides}
                    onOverridesChange={setHordeOverrides}
                    warnings={hordeOwnWarnings}
                  />
                  {hordeDeck.status === 'error' && (
                    <p className="lobby-horde-error" role="alert">
                      <span>Couldn't load that horde.</span>
                      <Button onClick={hordeDeck.retry}>Try again</Button>
                    </p>
                  )}
                </>
              ) : (
                <HordeReadOnly horde={game.horde} warnings={hordeOwnWarnings} />
              )}
            </section>
          )}

          <ul className="lobby-seats" role="list" aria-label="Seats">
            {seats.map((player, i) =>
              player ? (
                <SeatCard
                  key={player.id}
                  player={player}
                  isHost={player.userId != null && player.userId === game.hostUserId}
                  isMe={player.seat === mySeat.seat}
                  bracket={
                    player.seat === mySeat.seat && myDeck ? effectiveBracket(myDeck) : undefined
                  }
                  estimatedBracket={
                    player.seat === mySeat.seat && myDeck
                      ? myDeck.bracketEstimation?.bracket
                      : undefined
                  }
                  bracketOverridden={
                    player.seat === mySeat.seat && myDeck ? myDeck.bracketOverride != null : false
                  }
                  // A guest seat is the host's to manage: it has no device of
                  // its own, so its deck and its removal both happen here.
                  manage={isHost && player.userId === null ? { decks, dispatch } : undefined}
                />
              ) : (
                <OpenSeat
                  key={`open-${i}`}
                  seat={i}
                  canSeatGuest={isHost}
                  onSeatGuest={(name) =>
                    dispatch({
                      type: 'add-player',
                      player: makePlayer({
                        id: `guest_${i}_${Date.now()}`,
                        userId: null,
                        seat: i,
                        name,
                        startingLife: game.startingLife,
                      }),
                    })
                  }
                />
              )
            )}
          </ul>

          <p className="lobby-hint">
            Bracket numbers are estimates. Talk them over with your playgroup before starting.
          </p>
        </div>
      </div>

      {/* Outside the two-column body on purpose. `position: sticky` measures
          against its containing block, and a grid cell is only as tall as its
          own row, so the bar can only follow the scroll if it hangs off the
          full-height `.lobby`. At >=1024 a left margin puts it back under the
          seats. */}
      <div className="lobby-bar">
        <div className="lobby-bar-group">
          {/* The randomizer moved inside the picker, where it can roll a
              starter deck too — a bar button could only ever see your own. */}
          <DeckPicker
            decks={decks}
            value={mySeat.deckId}
            valueName={mySeat.deckName}
            onChange={pickDeck}
          />
          {mySeat.deckId && (
            <Button to={deckBoardPath(mySeat.deckId)} className="lobby-bar-btn">
              Open board
            </Button>
          )}
        </div>

        <div className="lobby-bar-group lobby-bar-group--actions">
          <Button
            aria-pressed={mySeat.ready === true}
            onClick={() =>
              dispatch({
                type: 'set-ready',
                actorSeat: mySeat.seat,
                ready: mySeat.ready !== true,
              })
            }
            className={`lobby-bar-btn lobby-ready-btn ${mySeat.ready === true ? 'is-ready' : ''}`}
          >
            {mySeat.ready === true ? 'Ready' : "I'm ready"}
          </Button>

          {isHost ? (
            <>
              {/* The count still stops nagging once everyone is ready, but the
                  SLOT it lives in does not: emptying it used to pull Start
                  game sideways under the host's cursor at exactly the moment
                  they reached for it. The slot holds its width; the warning
                  comes and goes inside it. */}
              <span className="lobby-ready-slot">
                {!allReady && (
                  <span className="lobby-ready-count" aria-live="polite">
                    {readyCount} of {game.players.length} ready
                  </span>
                )}
              </span>
              <Button
                variant="primary"
                disabled={isHordeFormat && (hordeDeck.status !== 'loaded' || seatedCount < 1)}
                onClick={() => {
                  if (isHordeFormat) {
                    if (hordeDeck.status !== 'loaded') return;
                    // The final settings, a fresh seed (rolled here, same
                    // split as the first-player roll below) and the loaded
                    // deck's rev, batched with `start` so every device lands
                    // on the identical horde the instant the game goes live.
                    dispatch([
                      {
                        type: 'horde-setup',
                        hordeId,
                        level: hordeLevel,
                        settings: resolveHordeSettings(hordeLevel, seatedCount, hordeOverrides),
                        seed: Math.floor(Math.random() * 0xffffffff) >>> 0,
                        deckRev: hordeDeck.rev,
                      },
                      { type: 'start' },
                    ]);
                    return;
                  }
                  // "Random" is a promise to roll at the last moment, not a
                  // seat — so the roll happens here, on the host's device,
                  // and the result is dispatched as an ordinary settings
                  // change. The reducer stays pure, and every seat sees the
                  // same first player.
                  if (game.startingSeat == null) {
                    const pick = pickFirstPlayer(game.players);
                    if (pick) {
                      dispatch({
                        type: 'note',
                        actorSeat: null,
                        message: `First player: ${pick.name}`,
                      });
                      dispatch({ type: 'settings', patch: { startingSeat: pick.seat } });
                    }
                  }
                  dispatch({ type: 'start' });
                }}
                className="lobby-bar-btn"
              >
                {isHordeFormat && hordeDeck.status === 'loading'
                  ? 'Loading the horde…'
                  : 'Start game'}
              </Button>
            </>
          ) : (
            <span className="lobby-waiting" aria-live="polite">
              Waiting for {hostName(game)} to start
            </span>
          )}

          <Button
            onClick={() => (isHost ? setConfirmLeave(true) : onLeave())}
            className="lobby-bar-btn lobby-leave-btn"
          >
            Leave
          </Button>
        </div>
      </div>

      {confirmLeave && (
        <ConfirmDialog
          title="End the table for everyone?"
          body={
            game.players.length > 1
              ? `Leaving ends the table for ${game.players.length === 2 ? 'the other player' : `all ${game.players.length - 1} other players`} still seated.`
              : 'Leaving ends the table.'
          }
          confirmLabel="End table"
          danger
          onConfirm={() => {
            setConfirmLeave(false);
            onLeave();
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

function formatLabel(format: GameFormat): string {
  if (format === 'horde') return 'Horde (co-op)';
  return FORMAT_OPTIONS.find((f) => f.value === format)?.label ?? 'Casual';
}

function hostName(game: GameState): string {
  return game.players.find((p) => p.userId === game.hostUserId)?.name ?? 'the host';
}

// ── Horde: the joiner's read-only view ──────────────────────────────────────

/**
 * A non-host seat never picks the horde — it reads what the host already
 * published to `game.horde` (design point 2/3). Deliberately its own small
 * view rather than `HordeSetupFields` in a disabled `<fieldset>`: a
 * non-interactive control still reads as a control, and this table's numbers
 * (not the host's live-editing draft) are the only thing a joiner needs.
 */
function HordeReadOnly({
  horde,
  warnings,
}: {
  horde: HordeTableState | undefined;
  warnings: HordeBanWarning[];
}) {
  if (!horde) {
    return <p className="lobby-horde-note">Setting up the horde…</p>;
  }
  const catalogEntry = HORDE_CATALOG.find((h) => h.id === horde.hordeId);
  return (
    <>
      <p className="lobby-horde-note">The host picks the horde.</p>
      {catalogEntry && (
        <div className="horde-tile lobby-horde-readonly is-selected">
          <span className="horde-tile-banner">
            <img src={catalogEntry.tileArt} alt="" aria-hidden="true" loading="lazy" />
          </span>
          <span className="horde-tile-body">
            <span className="horde-tile-name">{catalogEntry.name}</span>
            <span className="horde-tile-meta">
              <span className="horde-tile-pips" aria-hidden="true">
                {catalogEntry.themeColors.map((c) => (
                  <ColorPip key={c} color={c} />
                ))}
              </span>
              <span className="deck-format-badge">{catalogEntry.badge}</span>
            </span>
          </span>
        </div>
      )}
      {catalogEntry && <p className="horde-special-rule">{catalogEntry.specialRule}</p>}
      <p className="lobby-horde-summary">{levelSummary(horde.settings)}</p>
      {warnings.length > 0 && (
        <div className="horde-ban-warning" role="status">
          {warnings.map((w) => (
            <span key={`${w.seatName}-${w.cardName}`}>
              {w.seatName}: {w.cardName} is on the Horde ban list.
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// ── Seat card ───────────────────────────────────────────────────────────────

/**
 * An empty seat. For the host it is also the door for someone at the table
 * without a device of their own: name them and they hold the seat as a guest
 * — anyone seated can adjust their life once the game starts, and the record
 * carries the name with no account behind it.
 */
function OpenSeat({
  seat,
  canSeatGuest,
  onSeatGuest,
}: {
  seat: number;
  canSeatGuest: boolean;
  onSeatGuest: (name: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  if (!naming) {
    return (
      <li className="lobby-seat is-open">
        <span className="lobby-seat-avatar" aria-hidden="true">
          <UserRound width={22} height={22} strokeWidth={1.6} />
        </span>
        <span className="lobby-seat-openlabel">Open seat</span>
        {canSeatGuest && (
          <button
            type="button"
            className="lobby-seat-guest-btn"
            onClick={() => setNaming(true)}
            aria-label={`Seat a guest in seat ${seat + 1}`}
          >
            Seat a guest
          </button>
        )}
      </li>
    );
  }
  return (
    <li className="lobby-seat is-open is-naming">
      <form
        className="lobby-seat-guest-form"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, MAX_GUEST_NAME);
          if (!trimmed) return;
          onSeatGuest(trimmed);
          setName('');
          setNaming(false);
        }}
      >
        <label className="lobby-seat-guest-label">
          <span>Guest's name</span>
          <input
            ref={inputRef}
            className="lobby-seat-guest-input"
            value={name}
            maxLength={MAX_GUEST_NAME}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(false);
            }}
            placeholder="Who's sitting here?"
          />
        </label>
        <span className="lobby-seat-guest-hint">
          No account or device needed. The table tracks them.
        </span>
        <div className="lobby-seat-guest-actions">
          <Button onClick={() => setNaming(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            Seat them
          </Button>
        </div>
      </form>
    </li>
  );
}

function SeatCard({
  player,
  isHost,
  isMe,
  bracket: ownBracket,
  estimatedBracket,
  bracketOverridden,
  manage,
}: {
  player: GamePlayer;
  isHost: boolean;
  isMe: boolean;
  /** Your own seat's bracket, read from your own deck (fresher than the
   *  published number, and the one the estimate below is measured against).
   *  Every other seat falls back to the bracket its owner published. */
  bracket?: number;
  /** The auto-estimate, independent of `bracket` — shown alongside it
   *  whenever it differs and `bracket` is a stated bracket, not Auto
   *  (2026-09-24 ruling). Only ever set alongside `bracket`. */
  estimatedBracket?: number;
  /** True when `bracket` is the owner's stated bracket rather than Auto. */
  bracketOverridden?: boolean;
  /** Set when the viewer is the host and this is a guest seat they manage. */
  manage?: { decks: Deck[]; dispatch: (action: GameAction) => void };
}) {
  // Board E370: every seat publishes its own computed bracket (the device that
  // owns the deck ran the estimator and sent the number with deckId/commander),
  // so another player's seat shows theirs too. Your own seat reads your deck
  // directly. Null/absent means "no known bracket": never guessed.
  const bracket = ownBracket ?? player.bracket ?? undefined;
  const art = useCardThumb(player.commander ?? undefined, 'art_crop');
  const ready = player.ready === true;
  const isGuest = player.userId === null;
  return (
    <li
      className={`lobby-seat ${isMe ? 'is-me' : ''} ${isGuest ? 'is-guest' : ''}`}
      data-art={art ? 'on' : undefined}
      style={art ? { backgroundImage: `url(${art})` } : undefined}
    >
      {manage && (
        <button
          type="button"
          className="lobby-seat-remove"
          aria-label={`Remove ${player.name}`}
          onClick={() => manage.dispatch({ type: 'remove-player', seat: player.seat })}
        >
          <X width={16} height={16} strokeWidth={2} aria-hidden />
        </button>
      )}
      <div className="lobby-seat-body">
        <p className="lobby-seat-name">
          {isHost && <Crown width={15} height={15} strokeWidth={2} aria-label="Host" />}
          <span>{player.name}</span>
          {isMe && <span className="lobby-seat-you">You</span>}
          {isGuest && <span className="lobby-seat-guest">Guest</span>}
        </p>
        {manage ? (
          <div className="lobby-seat-manage-deck">
            <DeckPicker
              decks={manage.decks}
              value={player.deckId}
              valueName={player.deckName}
              onChange={(picked) =>
                manage.dispatch({
                  type: 'update-player',
                  seat: player.seat,
                  patch: {
                    deckId: picked?.id ?? null,
                    deckName: picked?.name ?? null,
                    commander: picked?.commander ?? null,
                    partner: picked?.partner ?? null,
                    colorIdentity: picked?.colorIdentity ?? [],
                    bracket: picked?.bracket ?? null,
                  },
                })
              }
            />
          </div>
        ) : (
          <p className="lobby-seat-deck">{player.deckName ?? 'No deck yet'}</p>
        )}
        <div className="lobby-seat-foot">
          <span className={`lobby-chip ${ready || isGuest ? 'is-ready' : ''}`}>
            {isGuest ? (
              'Seated by the host'
            ) : ready ? (
              <>
                <Check width={13} height={13} strokeWidth={2.5} aria-hidden /> Ready
              </>
            ) : player.deckId ? (
              'Not ready'
            ) : (
              'Choosing a deck'
            )}
          </span>
          <SeatPips ci={player.colorIdentity} />
          {bracket != null && (
            <span className="lobby-seat-bracket">
              {bracketOverridden && estimatedBracket != null && estimatedBracket !== bracket
                ? bracketTextWithEstimate(bracket, estimatedBracket)
                : `Bracket ${bracket}`}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Rail: settings + chat ───────────────────────────────────────────────────

function LobbyRail({
  game,
  isHost,
  mySeat,
  dispatch,
}: {
  game: GameState;
  isHost: boolean;
  mySeat: GamePlayer;
  dispatch: (action: GameAction) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(game.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (an insecure origin, or a WebView that refuses): the
      // code is on screen in full, so there is nothing to recover from.
    }
  };

  const isHordeFormat = game.format === 'horde';

  const startingPlayer =
    game.startingSeat != null
      ? (game.players.find((p) => p.seat === game.startingSeat)?.name ?? 'Unknown')
      : 'Random';

  const shuffleSeats = () => {
    // Fisher-Yates on the ids; the reducer only applies the order it is
    // given, so the roll belongs on this device (same split as the first
    // player above).
    const order = game.players.map((p) => p.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    dispatch({ type: 'reseat', order });
  };

  return (
    <aside className="lobby-rail" aria-label="Table settings and chat">
      {/* Always on screen: the code is the one thing a host needs to get
          people seated, so it has no dismiss control to strand them behind. */}
      <div className="play-code-banner lobby-code">
        <span className="play-code-label">Join code</span>
        <span className="play-code-value">{game.code}</span>
        <button
          type="button"
          className="play-code-copy"
          aria-label={copied ? 'Join code copied' : 'Copy join code'}
          onClick={() => void copyCode()}
        >
          {copied ? (
            <>
              <Check width={14} height={14} strokeWidth={2.5} aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy width={14} height={14} strokeWidth={2} aria-hidden /> Copy
            </>
          )}
        </button>
        <span className="play-code-hint">Share this code so others can join.</span>
      </div>

      <section className="lobby-section" aria-labelledby="lobby-settings-label">
        <h3 className="lobby-section-label" id="lobby-settings-label">
          Game settings
        </h3>

        <div className="lobby-setting">
          <span id="lobby-format-label">Format</span>
          {isHost ? (
            <SelectMenu<GameFormat>
              ariaLabel="Format"
              value={game.format}
              onChange={(next) => {
                if (next === 'horde') {
                  // A team turn has no commander damage or poison; the horde
                  // pick itself is seeded by the host's device separately
                  // (design point 2), once the horde section below mounts.
                  dispatch({
                    type: 'settings',
                    patch: { format: 'horde', commanderDamageEnabled: false, poisonEnabled: false },
                  });
                  return;
                }
                const cfg = FORMAT_OPTIONS.find((f) => f.value === next) ?? FORMAT_OPTIONS[0];
                dispatch({
                  type: 'settings',
                  patch: {
                    format: cfg.value,
                    startingLife: cfg.defaultLife,
                    commanderDamageEnabled: cfg.cmdDmg,
                  },
                });
              }}
              options={[
                ...FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label })),
                { value: 'horde' as const, label: 'Horde (co-op)' },
              ]}
            />
          ) : (
            <span className="lobby-setting-value">{formatLabel(game.format)}</span>
          )}
        </div>

        {isHordeFormat ? (
          // A team shares one life pool, resolved by `resolveHordeSettings`
          // from the seated count — nobody steps it by hand (design point 3).
          <div className="lobby-setting">
            <span>Shared life</span>
            <span className="lobby-setting-value">{game.startingLife}</span>
          </div>
        ) : (
          <div className="lobby-setting">
            <span id="lobby-life-label">Starting life</span>
            {isHost ? (
              <Stepper
                value={game.startingLife}
                min={1}
                max={200}
                step={5}
                ariaLabelledBy="lobby-life-label"
                onChange={(startingLife) => dispatch({ type: 'settings', patch: { startingLife } })}
              />
            ) : (
              <span className="lobby-setting-value">{game.startingLife}</span>
            )}
          </div>
        )}

        <div className="lobby-setting">
          <span id="lobby-mulligan-label">Mulligan</span>
          {isHost ? (
            <SelectMenu<MulliganType>
              ariaLabel="Mulligan"
              value={game.mulliganType ?? 'commander'}
              onChange={(mulliganType) => dispatch({ type: 'settings', patch: { mulliganType } })}
              options={MULLIGAN_OPTIONS}
            />
          ) : (
            <span className="lobby-setting-value">
              {MULLIGAN_OPTIONS.find((o) => o.value === (game.mulliganType ?? 'commander'))?.label}
            </span>
          )}
        </div>

        {!isHordeFormat && (
          // A team turn has no first player: everyone acts together.
          <div className="lobby-setting">
            <span>Starting player</span>
            {isHost ? (
              // "Random" is the absence of a pick, rolled when the game starts
              // — so the table can see it is undecided rather than reading a
              // name that was really chosen minutes ago.
              <SelectMenu<string>
                ariaLabel="Starting player"
                value={game.startingSeat == null ? RANDOM_SEAT : String(game.startingSeat)}
                onChange={(next) =>
                  dispatch({
                    type: 'settings',
                    patch: { startingSeat: next === RANDOM_SEAT ? null : Number(next) },
                  })
                }
                options={[
                  { value: RANDOM_SEAT, label: 'Random' },
                  ...game.players.map((p) => ({ value: String(p.seat), label: p.name })),
                ]}
              />
            ) : (
              <span className="lobby-setting-value">{startingPlayer}</span>
            )}
          </div>
        )}

        {isHost && game.players.length > 1 && (
          <div className="lobby-setting">
            <span>Seats</span>
            <Button
              onClick={shuffleSeats}
              className="lobby-randomize"
              icon={<Shuffle width={14} height={14} strokeWidth={2} />}
            >
              Shuffle
            </Button>
          </div>
        )}

        {isHost ? (
          <>
            {!isHordeFormat && (
              <>
                <RuleToggle
                  labelId="lobby-cmddmg-label"
                  label="Commander damage"
                  hint="Lose at 21 combat damage from a single commander."
                  on={game.commanderDamageEnabled}
                  onChange={(commanderDamageEnabled) =>
                    dispatch({ type: 'settings', patch: { commanderDamageEnabled } })
                  }
                />
                <RuleToggle
                  labelId="lobby-poison-label"
                  label="Poison counters"
                  hint="Lose at 10 poison counters."
                  on={game.poisonEnabled}
                  onChange={(poisonEnabled) =>
                    dispatch({ type: 'settings', patch: { poisonEnabled } })
                  }
                />
              </>
            )}
            <RuleToggle
              labelId="lobby-turntimer-label"
              label="Turn timer"
              hint="Shows how long the current turn has run. Nothing expires."
              on={game.turnTimerEnabled ?? false}
              onChange={(turnTimerEnabled) =>
                dispatch({ type: 'settings', patch: { turnTimerEnabled } })
              }
            />
            <div className="lobby-setting lobby-setting--voice">
              <span className="lobby-voice-label" id="lobby-visibility-label">
                Visibility
              </span>
              <VisibilityChoice
                ariaLabel="Visibility"
                value={game.visibility ?? 'private'}
                options={[
                  {
                    value: 'public',
                    label: 'Public',
                    hint: 'Listed in the room browser. Anyone can watch.',
                  },
                  {
                    value: 'friends',
                    label: 'Friends',
                    hint: 'Listed for your friends. They can watch.',
                  },
                  { value: 'private', label: 'Private', hint: 'Only people with the code.' },
                ]}
                onChange={(visibility) => dispatch({ type: 'settings', patch: { visibility } })}
              />
            </div>
            <VoiceLinkRow game={game} dispatch={dispatch} />
          </>
        ) : (
          <>
            {!isHordeFormat && (
              <>
                <div className="lobby-setting">
                  <span>Commander damage</span>
                  <span className="lobby-setting-value">
                    {game.commanderDamageEnabled ? 'On' : 'Off'}
                  </span>
                </div>
                <div className="lobby-setting">
                  <span>Poison counters</span>
                  <span className="lobby-setting-value">{game.poisonEnabled ? 'On' : 'Off'}</span>
                </div>
              </>
            )}
            <div className="lobby-setting">
              <span>Turn timer</span>
              <span className="lobby-setting-value">{game.turnTimerEnabled ? 'On' : 'Off'}</span>
            </div>
            <div className="lobby-setting">
              <span>Visibility</span>
              <span className="lobby-setting-value">
                {game.visibility === 'public'
                  ? 'Public'
                  : game.visibility === 'friends'
                    ? 'Friends'
                    : 'Private'}
              </span>
            </div>
            {game.voiceUrl && (
              <div className="lobby-setting">
                <span>Voice</span>
                <a
                  className="lobby-setting-value lobby-voice-link"
                  href={game.voiceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Join the call
                </a>
              </div>
            )}
          </>
        )}
      </section>

      <LobbyChat game={game} mySeat={mySeat} dispatch={dispatch} />
    </aside>
  );
}

/**
 * A rule toggle, sized to sit in the settings list beside the plain rows
 * above it (Format, Starting life, ...) rather than as its own full-width
 * `SwitchRow`. This is a lobby-only compact switch that trades the
 * always-visible hint sentence for a tooltip, since a row this size has no
 * room for one and still read as a setting, not clutter.
 */
function RuleToggle({
  labelId,
  label,
  hint,
  on,
  onChange,
}: {
  labelId: string;
  label: string;
  hint: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="lobby-setting">
      <span id={labelId}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        title={hint}
        className={`lobby-toggle ${on ? 'is-on' : ''}`}
        onClick={() => onChange(!on)}
      >
        {on ? 'On' : 'Off'}
      </button>
    </div>
  );
}

/**
 * Where the table is talking. A link the host pastes, shown to everyone else
 * as a link they can open — this app does not carry voice, and every pod
 * already has somewhere it talks.
 *
 * Committed on blur or Enter rather than per keystroke: each commit is a
 * `settings` action that every seat sees, and one per character would flood
 * the lobby. Anything but an https link is refused by the route, so the row
 * says so before the round trip.
 */
function VoiceLinkRow({
  game,
  dispatch,
}: {
  game: GameState;
  dispatch: (action: GameAction) => void;
}) {
  const saved = game.voiceUrl ?? '';
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  // The host may not be the only one editing; take the server's value back
  // whenever it changes under us rather than holding a stale draft.
  const lastSaved = useRef(saved);
  useEffect(() => {
    if (lastSaved.current !== saved) {
      lastSaved.current = saved;
      setDraft(saved);
    }
  }, [saved]);

  const commit = () => {
    const next = draft.trim();
    if (next === saved) return;
    if (next === '') {
      setError(null);
      dispatch({ type: 'settings', patch: { voiceUrl: null } });
      return;
    }
    let url: URL;
    try {
      url = new URL(next);
    } catch {
      setError('That is not a link.');
      return;
    }
    if (url.protocol !== 'https:') {
      setError('Voice links start with https.');
      return;
    }
    setError(null);
    dispatch({ type: 'settings', patch: { voiceUrl: next } });
  };

  return (
    <div className="lobby-setting lobby-setting--voice">
      <label className="lobby-voice-label" htmlFor="lobby-voice-url">
        Voice link
      </label>
      <input
        id="lobby-voice-url"
        className="lobby-voice-input"
        type="url"
        inputMode="url"
        value={draft}
        placeholder="Discord, Meet, anywhere"
        maxLength={2048}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        aria-describedby={error ? 'lobby-voice-error' : undefined}
      />
      {error && (
        <p className="lobby-voice-error" id="lobby-voice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function LobbyChat({
  game,
  mySeat,
  dispatch,
}: {
  game: GameState;
  mySeat: GamePlayer;
  dispatch: (action: GameAction) => void;
}) {
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLOListElement>(null);
  const lines = game.events.filter((e) => FEED_KINDS.has(e.kind));

  // Newest at the bottom, and the bottom is where the eye is: pin the scroller
  // there on every new line rather than leaving the latest message below the
  // fold.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const trimmed = draft.trim();

  return (
    <section className="lobby-section lobby-chat" aria-labelledby="lobby-chat-label">
      <h3 className="lobby-section-label" id="lobby-chat-label">
        Chat
      </h3>
      <ol className="lobby-feed" ref={feedRef} aria-live="polite" aria-label="Table chat">
        {lines.length === 0 && <li className="lobby-feed-empty">No messages yet.</li>}
        {lines.map((ev) => (
          <li key={ev.id} className={`lobby-line ${ev.actorSeat == null ? 'is-system' : ''}`}>
            <span className="lobby-line-time">{timeOf(ev.ts)}</span>
            <span className="lobby-line-who">{authorOf(ev, game)}</span>
            <span className="lobby-line-text">{textOf(ev)}</span>
          </li>
        ))}
      </ol>
      <form
        className="lobby-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) return;
          setDraft('');
          dispatch({
            type: 'note',
            actorSeat: mySeat.seat,
            message: trimmed.slice(0, MAX_CHAT_LEN),
          });
        }}
      >
        <label className="sr-only" htmlFor="lobby-chat-input">
          Message the table
        </label>
        <input
          id="lobby-chat-input"
          className="lobby-composer-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the table"
          maxLength={MAX_CHAT_LEN}
          autoComplete="off"
        />
        <Button type="submit" disabled={!trimmed} className="lobby-composer-send">
          Send
        </Button>
      </form>
    </section>
  );
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function authorOf(ev: GameEvent, game: GameState): string {
  if (ev.actorSeat == null) return 'Table';
  return game.players.find((p) => p.seat === ev.actorSeat)?.name ?? 'Someone';
}

function textOf(ev: GameEvent): string {
  if (ev.kind === 'join') return `${ev.message ?? 'A player'} joined`;
  if (ev.kind === 'leave') return `${ev.message ?? 'A player'} left`;
  return ev.message ?? '';
}
