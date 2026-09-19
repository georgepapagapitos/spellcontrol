import { Check, Copy, Crown, Shuffle, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../ConfirmDialog';
import { SelectMenu } from '../SelectMenu';
import { DeckPicker, RulePill, SeatPips, Stepper } from './SetupControls';
import { FORMAT_OPTIONS } from '../../lib/game-formats';
import { pickFirstPlayer } from '../../lib/game-tools';
import { useCardThumb } from '../../lib/card-thumbs';
import { effectiveBracket, type Deck } from '../../store/decks';
import type {
  GameAction,
  GameEvent,
  GameFormat,
  GamePlayer,
  GameState,
} from '../../lib/game-state';
import './OnlineLobby.css';

/** Seats an online table shows before anyone joins. The server seats up to 8;
 *  a pod is four, so four is what the grid promises and it grows from there. */
const MIN_SEATS = 4;
const MAX_SEATS = 8;
const MAX_CHAT_LEN = 240;

/** Chat and system lines share one feed, newest last. */
const FEED_KINDS = new Set<GameEvent['kind']>(['note', 'join', 'leave']);

interface Props {
  game: GameState;
  decks: Deck[];
  userId: string | null;
  mySeat: GamePlayer;
  errorMessage?: string | null;
  dispatch: (action: GameAction) => void;
  onLeave: () => void;
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

  const seats: Array<GamePlayer | null> = useMemo(() => {
    const count = Math.min(MAX_SEATS, Math.max(MIN_SEATS, game.players.length));
    return Array.from({ length: count }, (_, i) => game.players.find((p) => p.seat === i) ?? null);
  }, [game.players]);

  const readyCount = game.players.filter((p) => p.ready === true).length;
  const allReady = readyCount === game.players.length;
  const myDeck = mySeat.deckId ? (decks.find((d) => d.id === mySeat.deckId) ?? null) : null;

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
          <h2 className="lobby-title">{formatLabel(game.format)} table</h2>

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
                />
              ) : (
                <li key={`open-${i}`} className="lobby-seat is-open">
                  <span className="lobby-seat-avatar" aria-hidden="true">
                    <UserRound width={22} height={22} strokeWidth={1.6} />
                  </span>
                  <span className="lobby-seat-openlabel">Open seat</span>
                </li>
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
          <DeckPicker
            decks={decks}
            value={mySeat.deckId}
            onChange={(deck) =>
              dispatch({
                type: 'update-player',
                seat: mySeat.seat,
                patch: {
                  deckId: deck?.id ?? null,
                  deckName: deck?.name ?? null,
                  commander: deck?.commander?.name ?? null,
                  partner: deck?.partnerCommander?.name ?? null,
                  colorIdentity: deck?.commander?.color_identity ?? [],
                },
              })
            }
          />
          {mySeat.deckId && (
            <Link to={`/decks/${mySeat.deckId}/playtest`} className="btn lobby-bar-btn">
              Open board
            </Link>
          )}
        </div>

        <div className="lobby-bar-group">
          <button
            type="button"
            className={`btn lobby-bar-btn lobby-ready-btn ${mySeat.ready === true ? 'is-ready' : ''}`}
            aria-pressed={mySeat.ready === true}
            onClick={() =>
              dispatch({
                type: 'set-ready',
                actorSeat: mySeat.seat,
                ready: mySeat.ready !== true,
              })
            }
          >
            {mySeat.ready === true ? 'Ready' : "I'm ready"}
          </button>

          {isHost ? (
            <>
              {!allReady && (
                <span className="lobby-ready-count" aria-live="polite">
                  {readyCount} of {game.players.length} ready
                </span>
              )}
              <button
                type="button"
                className="btn btn-primary lobby-bar-btn"
                onClick={() => dispatch({ type: 'start' })}
              >
                Start game
              </button>
            </>
          ) : (
            <span className="lobby-waiting" aria-live="polite">
              Waiting for {hostName(game)} to start
            </span>
          )}

          <button
            type="button"
            className="btn lobby-bar-btn lobby-leave-btn"
            onClick={() => (isHost ? setConfirmLeave(true) : onLeave())}
          >
            Leave
          </button>
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
  return FORMAT_OPTIONS.find((f) => f.value === format)?.label ?? 'Casual';
}

function hostName(game: GameState): string {
  return game.players.find((p) => p.userId === game.hostUserId)?.name ?? 'the host';
}

// ── Seat card ───────────────────────────────────────────────────────────────

function SeatCard({
  player,
  isHost,
  isMe,
  bracket,
}: {
  player: GamePlayer;
  isHost: boolean;
  isMe: boolean;
  /** Only ever set for your own seat: the state carries no bracket for anyone
   *  else's deck, and a guessed one would be a number the table argues over. */
  bracket?: number;
}) {
  const art = useCardThumb(player.commander ?? undefined, 'art_crop');
  const ready = player.ready === true;
  return (
    <li
      className={`lobby-seat ${isMe ? 'is-me' : ''}`}
      data-art={art ? 'on' : undefined}
      style={art ? { backgroundImage: `url(${art})` } : undefined}
    >
      <div className="lobby-seat-body">
        <p className="lobby-seat-name">
          {isHost && <Crown width={15} height={15} strokeWidth={2} aria-label="Host" />}
          <span>{player.name}</span>
          {isMe && <span className="lobby-seat-you">You</span>}
        </p>
        <p className="lobby-seat-deck">{player.deckName ?? 'No deck yet'}</p>
        <div className="lobby-seat-foot">
          <span className={`lobby-chip ${ready ? 'is-ready' : ''}`}>
            {ready ? (
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
          {bracket != null && <span className="lobby-seat-bracket">Bracket {bracket}</span>}
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
  const [dismissedCode, setDismissedCode] = useState(false);

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

  const startingPlayer =
    game.startingSeat != null
      ? (game.players.find((p) => p.seat === game.startingSeat)?.name ?? 'Unknown')
      : 'Not decided';

  const randomizeFirst = () => {
    const pick = pickFirstPlayer(game.players);
    if (!pick) return;
    dispatch({ type: 'note', actorSeat: null, message: `First player: ${pick.name}` });
    dispatch({ type: 'settings', patch: { startingSeat: pick.seat } });
  };

  return (
    <aside className="lobby-rail" aria-label="Table settings and chat">
      {!dismissedCode && (
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
          <span className="play-code-hint">
            Players go to Play, then Online, then Join, and enter this code.
          </span>
          <button
            type="button"
            className="play-code-dismiss"
            aria-label="Hide join code"
            onClick={() => setDismissedCode(true)}
          >
            <X width={16} height={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}

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
              options={FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
            />
          ) : (
            <span className="lobby-setting-value">{formatLabel(game.format)}</span>
          )}
        </div>

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

        <div className="lobby-setting">
          <span>Starting player</span>
          <span className="lobby-setting-value">{startingPlayer}</span>
          {isHost && (
            <button type="button" className="btn lobby-randomize" onClick={randomizeFirst}>
              <Shuffle width={14} height={14} strokeWidth={2} aria-hidden />
              Randomize
            </button>
          )}
        </div>

        {isHost ? (
          <div className="lobby-rules">
            <RulePill
              on={game.commanderDamageEnabled}
              onChange={(commanderDamageEnabled) =>
                dispatch({ type: 'settings', patch: { commanderDamageEnabled } })
              }
              label="Commander damage"
              hint="Lose at 21 combat damage from a single commander."
            />
            <RulePill
              on={game.poisonEnabled}
              onChange={(poisonEnabled) => dispatch({ type: 'settings', patch: { poisonEnabled } })}
              label="Poison counters"
              hint="Lose at 10 poison counters."
            />
          </div>
        ) : (
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
      </section>

      <LobbyChat game={game} mySeat={mySeat} dispatch={dispatch} />
    </aside>
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
        <button type="submit" className="btn lobby-composer-send" disabled={!trimmed}>
          Send
        </button>
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
