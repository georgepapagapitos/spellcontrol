import { Eye, Swords } from 'lucide-react';
import { useState } from 'react';
import { type Deck } from '@/store/decks';
import { RoomBrowser } from '@/components/play/RoomBrowser';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { VisibilityChoice } from '@/components/share/VisibilityChoice';
import { Tabs } from '@/components/overlays/Tabs';
import { FORMAT_OPTIONS } from '@/lib/play/game-formats';
import { SeatPips } from '@/components/play/SetupControls';
import type { PickedDeck } from '@/components/play/DeckPickerDialog';
import { deckBoardPath } from '@/lib/play/starter-decks';
import type { GameAction, GameFormat, GameState } from '@/lib/play/game-state';
import type { PublicBoard } from '@/lib/playtest/projection';
import { Button } from '@/components/shared/Button';
import { SeatDeck } from './SeatControls';

export function OnlineSetup({
  decks,
  onHost,
  onJoin,
  onWatch,
  defaultName,
  hasActive,
  initialMode,
  initialCode,
}: {
  decks: Deck[];
  onHost: (opts: {
    format: GameFormat;
    startingLife: number;
    commanderDamageEnabled: boolean;
    poisonEnabled: boolean;
    hostName: string;
    hostDeckId: string | null;
    hostDeckName: string | null;
    hostCommander: string | null;
    hostPartner: string | null;
    hostColorIdentity: string[];
    hostBracket: 1 | 2 | 3 | 4 | 5 | null;
    name: string;
    visibility: GameState['visibility'];
  }) => void;
  onJoin: (
    code: string,
    opts: {
      name: string;
      deckId: string | null;
      deckName: string | null;
      commander: string | null;
      partner: string | null;
      colorIdentity: string[];
      bracket: 1 | 2 | 3 | 4 | 5 | null;
    }
  ) => void;
  onWatch: (code: string) => void;
  defaultName: string;
  hasActive: boolean;
  /** Which form opens first — the dashboard's doors pick one. */
  initialMode?: 'host' | 'join' | 'browse';
  /** A join code from the address (a Discord looking-for-game post links
   *  `?mode=join&code=TK7T`), so the form opens filled in. */
  initialCode?: string;
}) {
  const [mode, setMode] = useState<'host' | 'join' | 'browse'>(initialMode ?? 'host');
  const [format, setFormat] = useState<GameFormat>('commander');
  const [name, setName] = useState(defaultName);
  const [deck, setDeck] = useState<PickedDeck | null>(null);
  const [code, setCode] = useState(
    () =>
      initialCode
        ?.toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 4) ?? ''
  );
  // Identity/visibility for the TABLE, not the player — tuned at create,
  // unlike every rules field below which is left for the lobby to argue over.
  const [tableName, setTableName] = useState('');
  const [visibility, setVisibility] = useState<GameState['visibility']>('private');

  // The format decides the table's opening rules; the host tunes them in the
  // lobby afterwards, so they are derived here rather than held as state.
  const cfg = FORMAT_OPTIONS.find((f) => f.value === format) ?? FORMAT_OPTIONS[0];
  const startingLife = cfg.defaultLife;
  // A team turn has no commander damage; the lobby seeds the actual horde
  // pick once the table exists (OnlineLobby's Format select does the same).
  const commanderDamageEnabled = format === 'horde' ? false : cfg.cmdDmg;
  const poisonEnabled = false;

  function applyFormat(next: GameFormat) {
    setFormat(next);
  }

  return (
    <div className="play-setup play-setup--online">
      <Tabs<'host' | 'join' | 'browse'>
        ariaLabel="Online game mode"
        value={mode}
        onChange={setMode}
        variant="fitted"
        className="play-online-mode-tabs"
        tabs={[
          { id: 'host', label: 'Host' },
          { id: 'join', label: 'Join' },
          { id: 'browse', label: 'Browse' },
        ]}
      />

      {mode === 'browse' ? (
        <RoomBrowser
          onJoin={(code) =>
            onJoin(code, {
              name: name || defaultName,
              deckId: deck?.id ?? null,
              deckName: deck?.name ?? null,
              commander: deck?.commander ?? null,
              partner: deck?.partner ?? null,
              colorIdentity: deck?.colorIdentity ?? [],
              bracket: deck?.bracket ?? null,
            })
          }
          onWatch={onWatch}
          onHostInstead={() => setMode('host')}
        />
      ) : mode === 'host' ? (
        <form
          className="play-setup-form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            onHost({
              format,
              startingLife,
              commanderDamageEnabled,
              poisonEnabled,
              hostName: name || defaultName,
              hostColorIdentity: deck?.colorIdentity ?? [],
              hostDeckId: deck?.id ?? null,
              hostDeckName: deck?.name ?? null,
              hostCommander: deck?.commander ?? null,
              hostPartner: deck?.partner ?? null,
              hostBracket: deck?.bracket ?? null,
              name: tableName.trim(),
              visibility,
            });
          }}
        >
          <header className="play-setup-header">
            <h2 className="play-setup-title">
              {hasActive ? 'Host a different game' : 'Host a game'}
            </h2>
            <p className="play-setup-help">
              You'll get a 4-character code to share.
              {hasActive && ' Hosting a new game will leave the one you have minimized.'}
            </p>
          </header>

          {/* Format alone: it sets the defaults for everything else, and
              every other table rule (life, commander damage, poison, the
              mulligan, the timer) belongs in the lobby, where the pod can see
              and argue about it. Asking twice was the old shape. Name and
              visibility aren't rules either, but they're the table's
              identity rather than something to tune later, so they join
              Format here. */}
          <section className="play-setup-row play-setup-game">
            <div className="play-field play-field-inline">
              <span>Format</span>
              <SelectMenu<GameFormat>
                ariaLabel="Format"
                value={format}
                onChange={applyFormat}
                options={[
                  ...FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label })),
                  { value: 'horde' as const, label: 'Horde (co-op)' },
                ]}
              />
            </div>
            <label className="play-field play-field-inline">
              <span>Name</span>
              <input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                maxLength={60}
                placeholder="Bracket 3 chill"
              />
            </label>
          </section>

          <section className="play-setup-row">
            <VisibilityChoice
              ariaLabel="Table visibility"
              value={visibility}
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
              onChange={setVisibility}
            />
          </section>

          <section className="play-setup-roster" aria-label="You">
            <header className="play-setup-roster-head">
              <h3 className="play-setup-section-title">You</h3>
            </header>
            <ul className="play-setup-roster-list">
              <li className="play-setup-seat">
                <span className="play-setup-seat-num" aria-hidden="true">
                  1
                </span>
                <input
                  className="play-setup-seat-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  aria-label="Your name"
                  placeholder={defaultName}
                />
                <SeatPips ci={deck?.colorIdentity ?? []} />
                <SeatDeck
                  decks={decks}
                  value={deck?.id ?? null}
                  deckName={deck?.name ?? null}
                  onChange={setDeck}
                />
              </li>
            </ul>
          </section>

          <Button
            variant="primary"
            type="submit"
            className="play-setup-start"
            icon={<Swords width={16} height={16} strokeWidth={2} />}
          >
            Create game
          </Button>
        </form>
      ) : (
        <form
          className="play-setup-form-join"
          onSubmit={(e) => {
            e.preventDefault();
            onJoin(code.trim().toUpperCase(), {
              name: name || defaultName,
              deckId: deck?.id ?? null,
              deckName: deck?.name ?? null,
              commander: deck?.commander ?? null,
              partner: deck?.partner ?? null,
              colorIdentity: deck?.colorIdentity ?? [],
              bracket: deck?.bracket ?? null,
            });
          }}
        >
          <header className="play-setup-header">
            <h2 className="play-setup-title">Join a game</h2>
            <p className="play-setup-help">Enter the host's 4-character code.</p>
          </header>

          <section className="play-setup-row">
            <label className="play-field play-field-inline">
              <span>Join code</span>
              <input
                className="play-join-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="ABCD"
                maxLength={4}
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </label>
          </section>

          <section className="play-setup-roster" aria-label="You">
            <header className="play-setup-roster-head">
              <h3 className="play-setup-section-title">You</h3>
            </header>
            <ul className="play-setup-roster-list">
              <li className="play-setup-seat">
                <span className="play-setup-seat-num" aria-hidden="true">
                  1
                </span>
                <input
                  className="play-setup-seat-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  aria-label="Your name"
                  placeholder={defaultName}
                />
                <SeatPips ci={deck?.colorIdentity ?? []} />
                <SeatDeck
                  decks={decks}
                  value={deck?.id ?? null}
                  deckName={deck?.name ?? null}
                  onChange={setDeck}
                />
              </li>
            </ul>
          </section>

          <Button
            variant="primary"
            type="submit"
            disabled={code.trim().length < 3}
            className="play-setup-start"
            icon={<Swords width={16} height={16} strokeWidth={2} />}
          >
            Join game
          </Button>
          {/* Watching needs the code and nothing else — no name, no deck, no
              seat. It only works on a table whose host switched watchers on;
              otherwise the read comes back as if the code were unknown, and
              the error says so. */}
          <Button
            disabled={code.trim().length < 3}
            onClick={() => onWatch(code.trim().toUpperCase())}
            className="play-setup-watch"
            icon={<Eye width={16} height={16} strokeWidth={2} />}
          >
            Watch without a seat
          </Button>
        </form>
      )}
    </div>
  );
}

// ── Open-your-board door ────────────────────────────────────────────────────

/**
 * The missing link between the online life-counter (this page) and the
 * card-table playtest view (`/decks/:id/playtest`) — the two are otherwise
 * connected only by `useOnlineTable`'s derived seam, with nothing on this
 * page ever mentioning that a board exists. Renders inside `GameBoard`'s
 * banner slot, so it's visible in the lobby (pre-start) and mid-game alike,
 * and survives a tab close/reopen exactly like the board itself does.
 *
 * `onlineBoards` is keyed by seat and includes the VIEWER's own seat once
 * their board has published — the server fans a published board out to
 * every subscriber for the code, including the publisher's own connection
 * (see `broadcastBoard` in backend/src/routes/games.ts). So counting "how
 * many boards are open" is a single pass over `onlineBoards` with no
 * separate +1 for "me" — adding one would double-count once this seat's
 * board is open.
 */
export function OnlineBoardDoor({
  game,
  decks,
  userId,
  onlineBoards,
  dispatchOnline,
}: {
  game: GameState;
  decks: Deck[];
  userId: string | null;
  onlineBoards: Record<number, PublicBoard>;
  dispatchOnline: (action: GameAction) => Promise<void>;
}) {
  const mine = userId != null ? (game.players.find((p) => p.userId === userId) ?? null) : null;
  // No seat (spectating, or this device's user doesn't hold one in this
  // session) — there is no "your board" to open, so there is no door.
  if (!mine) return null;

  const total = game.players.length;
  const openCount = game.players.filter((p) => onlineBoards[p.seat] != null).length;
  const myBoardOpen = onlineBoards[mine.seat] != null;
  // The moment the door matters most: the game is live and this seat is the
  // one everyone else is waiting on. Once the board is open, recede — don't
  // keep shouting at someone already playing.
  const urgent = game.status === 'active' && !myBoardOpen;

  return (
    <section
      className={`play-board-door ${urgent ? 'is-urgent' : ''} ${myBoardOpen ? 'is-receded' : ''}`}
      aria-label="Your board"
    >
      {/* Who else is on their board is a comparison, so it needs someone to
          compare with: alone at the table it read as "0 of 1 board open · You",
          which is a count of yourself. */}
      {total > 1 && (
        <div className="play-board-door-summary">
          <span className="play-board-door-count">
            {openCount} of {total} boards open
          </span>
          <ul className="play-board-door-seats">
            {game.players.map((p) => {
              const open = onlineBoards[p.seat] != null;
              const label = p.userId === userId ? 'You' : p.name;
              return (
                <li
                  key={p.seat}
                  className={`play-board-door-seat ${open ? 'is-open' : ''}`}
                  aria-label={`${label} — ${open ? 'board open' : 'no board yet'}`}
                >
                  <span className="play-board-door-seat-dot" aria-hidden="true" />
                  <span aria-hidden="true">{label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!mine.deckId ? (
        <div className="play-board-door-pick">
          <span className="play-board-door-hint">Pick a deck to open your board</span>
          <SeatDeck
            decks={decks}
            value={mine.deckId}
            deckName={mine.deckName}
            onChange={(picked) => {
              if (!picked) return;
              void dispatchOnline({
                type: 'update-player',
                seat: mine.seat,
                patch: {
                  deckId: picked.id,
                  deckName: picked.name,
                  commander: picked.commander,
                  partner: picked.partner,
                  colorIdentity: picked.colorIdentity,
                },
              });
            }}
          />
        </div>
      ) : (
        <Button
          to={deckBoardPath(mine.deckId)}
          variant={urgent ? 'primary' : 'secondary'}
          className="play-board-door-cta"
        >
          {myBoardOpen ? 'Back to your board' : 'Open your board'}
        </Button>
      )}
    </section>
  );
}
