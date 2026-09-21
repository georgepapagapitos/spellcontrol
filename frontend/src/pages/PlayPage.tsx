// The play table's stylesheets ship with this chunk, not the boot payload
// (E265) — same relative order as the former main.tsx block.
import '@/styles/play-setup.css';
import '@/styles/play-board.css';
import '@/styles/play-panel-menus.css';
import '@/styles/play-history-inline.css';
import '@/styles/play-effects.css';
import '@/styles/play-enhancements.css';
import '@/styles/play-layout-editor.css';
import '@/styles/play-counters-panel.css';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';
import { Check, Copy, Eye, Swords, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSignInPath } from '../lib/sign-in-path';
import { useAuth } from '../store/auth';
import { useDecksStore, type Deck } from '../store/decks';
import {
  aggregateDeckRecords,
  gameToRematch,
  recordToRematch,
  usePlayStore,
  type LocalGameSetup,
  type SeatSeed,
} from '../store/play';
import { listFriends, type Friend } from '../lib/friends-client';
import { getPod, listPods, type Pod } from '../lib/pods-client';
import { formatIdentity } from '../lib/display-name';
import { toast } from '../store/toasts';
import { GameBoard } from '../components/play/GameBoard';
import { EndGameDialog } from '../components/play/EndGameDialog';
import { OnlineGameView } from '../components/play/OnlineGameView';
import { OnlineLobby } from '../components/play/OnlineLobby';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SelectMenu } from '../components/SelectMenu';
import { Tabs } from '../components/Tabs';
import { StackedBar } from '../components/shared/MeterBar';
import { FriendsLeaderboard } from '../components/play/FriendsLeaderboard';
import { GameNightsTab, pendingInviteCount, useGameNights } from '../components/play/GameNights';
import { aggregateMatchupRecords } from '../lib/matchup-records';
import { FORMAT_OPTIONS, MAX_LOCAL_PLAYERS, MIN_LOCAL_PLAYERS } from '../lib/game-formats';
import { MAX_COUNTERS_PER_SCOPE, MAX_COUNTER_NAME_LENGTH } from '../lib/game-state';
import { DeckPicker, RulePill, SeatPips, Stepper } from '../components/play/SetupControls';
import type { PickedDeck } from '../components/play/DeckPickerDialog';
import { deckBoardPath } from '../lib/starter-decks';
import { TableProfiles } from '../components/play/TableProfiles';
import type { GameAction, GameFormat, GamePlayer, GameRecord, GameState } from '../lib/game-state';
import type { PublicBoard } from '../lib/playtest/projection';

import { userMessage } from '@/lib/user-error';
import { PlayHome, type PlayHomeTarget } from '../components/play/PlayHome';
type Tab = 'home' | 'local' | 'online' | 'nights' | 'history';
const TABS: ReadonlySet<string> = new Set(['home', 'local', 'online', 'nights', 'history']);

export function PlayPage() {
  const [params, setParams] = useSearchParams();
  const user = useAuth((s) => s.user);
  const isGuest = useAuth((s) => s.status === 'guest');
  const signInHref = useSignInPath();
  const decks = useDecksStore((s) => s.decks);

  const local = usePlayStore((s) => s.local);
  const online = usePlayStore((s) => s.online);
  const onlineBoards = usePlayStore((s) => s.onlineBoards);
  const history = usePlayStore((s) => s.history);
  const onlineError = usePlayStore((s) => s.onlineError);
  const boardVisible = usePlayStore((s) => s.boardVisible);

  const startLocal = usePlayStore((s) => s.startLocal);
  const rematchLocal = usePlayStore((s) => s.rematchLocal);
  const dispatchLocal = usePlayStore((s) => s.dispatchLocal);
  const endLocal = usePlayStore((s) => s.endLocal);
  const discardLocal = usePlayStore((s) => s.discardLocal);

  const hostOnline = usePlayStore((s) => s.hostOnline);
  const joinOnline = usePlayStore((s) => s.joinOnline);
  const watchOnline = usePlayStore((s) => s.watchOnline);
  const dispatchOnline = usePlayStore((s) => s.dispatchOnline);
  const leaveOnline = usePlayStore((s) => s.leaveOnline);
  const refreshOnline = usePlayStore((s) => s.refreshOnline);

  const hideBoard = usePlayStore((s) => s.hideBoard);
  const showBoard = usePlayStore((s) => s.showBoard);

  // The lobby replaces the board only for a SEATED player before the host
  // starts. A spectator (no seat in this session) still gets the board view,
  // which is the only thing that has anything to show them.
  const onlineLobbySeat =
    online && online.status === 'lobby' && user?.id
      ? (online.players.find((p) => p.userId === user.id) ?? null)
      : null;

  // ── Start puts you at the table ────────────────────────────────────────
  // The board IS the online table; this tab is the lobby before a game and
  // the record after one. Landing on a life counter that then asks you to
  // "open your board" made Start feel like it had not started anything, and
  // put a second set of life / commander-damage / monarch controls in front
  // of the ones the board already carries.
  //
  // Once per game, and only for a seat that actually has a deck to open:
  // after that the player is free to come back here, and a `sessionStorage`
  // mark (not state) means a reload on this tab does not yank them away
  // again.
  const navigate = useNavigate();
  const mySeatDeckId =
    online && online.status === 'active' && user?.id
      ? (online.players.find((p) => p.userId === user.id)?.deckId ?? null)
      : null;
  const liveGameId = online && online.status === 'active' ? online.id : null;
  useEffect(() => {
    if (!liveGameId || !mySeatDeckId) return;
    const key = `spellcontrol:play:sentToBoard:${liveGameId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Private mode / blocked storage: without the mark this would send the
      // player to their board on every mount of this tab, which is worse
      // than never doing it. Skip rather than risk the loop.
      return;
    }
    navigate(deckBoardPath(mySeatDeckId));
  }, [liveGameId, mySeatDeckId, navigate]);

  // Where the page opens: the tab you asked for; else the table you're in the
  // middle of (a board on screen, or a live online seat); else the landing.
  // The landing page's "Start a game" door (`?new=1`) starts a local table
  // below, so it lands on the board, not on a dashboard offering to start one.
  const requested = params.get('tab');
  const initialTab: Tab =
    requested && TABS.has(requested)
      ? (requested as Tab)
      : params.get('new') === '1' || (local && boardVisible)
        ? 'local'
        : online
          ? 'online'
          : 'home';
  const [tab, setTabRaw] = useState<Tab>(initialTab);
  const setTab = (t: Tab) => {
    setTabRaw(t);
    setParams((p) => {
      p.set('tab', t);
      p.delete('mode');
      return p;
    });
  };
  // A dashboard door that opens Online can also say which form: host or join.
  const openFromHome = (target: PlayHomeTarget) => {
    setTabRaw(target.tab);
    setParams((p) => {
      p.set('tab', target.tab);
      if (target.tab === 'online' && target.mode) p.set('mode', target.mode);
      else p.delete('mode');
      return p;
    });
  };
  const onlineMode: 'host' | 'join' = params.get('mode') === 'join' ? 'join' : 'host';

  // Deep link from the landing page's "Start a game" door (`/play?new=1`):
  // start a table on arrival, so the promise is one tap rather than a tap plus
  // a form. The values are exactly what an untouched LocalSetup would submit,
  // so the door and the form can never disagree. The param is stripped with
  // `replace` first — before any early return — so a refresh or a Back never
  // restarts a game, and an already-running game always wins over the deep
  // link rather than being silently clobbered.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    setParams(
      (p) => {
        p.delete('new');
        return p;
      },
      { replace: true }
    );
    if (usePlayStore.getState().local) return;
    const fmt = FORMAT_OPTIONS[0];
    startLocal({
      format: fmt.value,
      startingLife: fmt.defaultLife,
      commanderDamageEnabled: fmt.cmdDmg,
      poisonEnabled: false,
      players: Array.from({ length: MIN_LOCAL_PLAYERS }, (_, i) => blankPlayer(`Player ${i + 1}`)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-attach polling on mount if we have an active online game in store.
  useEffect(() => {
    if (online) {
      usePlayStore.getState().startPolling();
      void refreshOnline();
    }
    return () => usePlayStore.getState().stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed in, the history is the server's record: post anything recorded
  // while offline first, then read the list back so both modes show up in
  // one place. Keyed on the user so a sign-in on this page reloads too.
  useEffect(() => {
    if (!user) return;
    const play = usePlayStore.getState();
    void play
      .flushPendingResults()
      .then(() => play.loadHistory())
      .catch(() => {
        /* the persisted list stays on screen; the next visit retries */
      });
  }, [user]);

  const gameNights = useGameNights(!isGuest);
  const inviteCount = pendingInviteCount(gameNights.nights);

  const [pendingEnd, setPendingEnd] = useState<'local' | 'online' | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState(false);
  // Starting a new local game while one is active overwrites it; hold the setup
  // here and confirm first instead of silently discarding the in-progress game.
  const [pendingStart, setPendingStart] = useState<LocalGameSetup | null>(null);
  // Which game's join-code banner the host dismissed. Keyed by code so a new
  // game's banner shows again without an effect to reset it.
  const [codeHiddenFor, setCodeHiddenFor] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const copyJoinCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      toast.show({ message: "Couldn't copy the code.", tone: 'error' });
    }
  };

  const handleStartLocal = (setup: LocalGameSetup) => {
    if (local) setPendingStart(setup);
    else startLocal(setup);
  };

  return (
    <div className="play-page">
      <header className="binder-hero play-page-hero">
        <div className="play-page-hero-text">
          <h1 className="binder-hero-name">Play</h1>
          <p className="play-page-hero-sub">
            Track a table in person, or play across devices with a join code.
          </p>
        </div>
        <Tabs<Tab>
          ariaLabel="Play sections"
          variant="underline"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'home', label: 'Play' },
            {
              id: 'local',
              label: (
                <>
                  Local
                  {local && <span className="play-tab-dot" aria-hidden="true" />}
                </>
              ),
              ariaLabel: local ? 'Local, game in progress' : undefined,
            },
            {
              id: 'online',
              label: (
                <>
                  Online
                  {online && <span className="play-tab-dot" aria-hidden="true" />}
                </>
              ),
              ariaLabel: online ? 'Online, game in progress' : undefined,
            },
            {
              id: 'nights',
              label: 'Game nights',
              count: inviteCount > 0 ? inviteCount : null,
              ariaLabel:
                inviteCount > 0 ? `Game nights, ${inviteCount} awaiting your reply` : undefined,
            },
            {
              id: 'history',
              label: 'History',
              count: history.length > 0 ? history.length : null,
            },
          ]}
        />
      </header>

      {tab === 'home' && (
        <PlayHome
          local={local}
          online={online}
          history={history}
          userId={user?.id ?? null}
          isGuest={isGuest}
          nights={gameNights.nights}
          nightsLoading={gameNights.loading}
          go={openFromHome}
          resumeLocal={() => {
            showBoard();
            openFromHome({ tab: 'local' });
          }}
        />
      )}

      {tab === 'local' && (
        <>
          {local && boardVisible ? (
            <GameBoard
              game={local}
              dispatch={dispatchLocal}
              canControlAll
              onMinimize={hideBoard}
              onEnd={() => setPendingEnd('local')}
              // A finished game is already in History — clearing it is not
              // destructive, so it doesn't ask. An in-progress one still does.
              onLeave={() =>
                local.status === 'finished' ? discardLocal() : setPendingDiscard(true)
              }
              onRematch={() => rematchLocal(gameToRematch(local))}
            />
          ) : (
            <>
              {local && (
                <ResumeBanner
                  game={local}
                  onResume={showBoard}
                  onDiscard={() => setPendingDiscard(true)}
                />
              )}
              <LocalSetup decks={decks} onStart={handleStartLocal} hasActive={!!local} />
            </>
          )}
        </>
      )}

      {tab === 'online' && (
        <>
          {online ? (
            onlineLobbySeat ? (
              /* Seated and not started yet: the lobby owns the whole surface.
                 The board (life totals, opponent tiles) answers a question
                 nobody has before a game begins, and the join code, deck
                 pick and Start button all live in the lobby instead. */
              <OnlineLobby
                game={online}
                decks={decks}
                userId={user?.id ?? null}
                mySeat={onlineLobbySeat}
                errorMessage={onlineError}
                dispatch={(action) => void dispatchOnline(action)}
                onLeave={() => void leaveOnline()}
              />
            ) : (
              <>
                {/* UX-323: only show the join-code banner while the game is still
                    in lobby/waiting. Once the game is active or finished, the
                    code has served its purpose. */}
                {online.status === 'lobby' && codeHiddenFor !== online.code && (
                  <div className="play-code-banner">
                    <span className="play-code-label">Join code</span>
                    <span className="play-code-value">{online.code}</span>
                    <button
                      type="button"
                      className="play-code-copy"
                      aria-label={codeCopied ? 'Join code copied' : 'Copy join code'}
                      onClick={() => void copyJoinCode(online.code)}
                    >
                      {codeCopied ? (
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
                      Players go to Play → Online → Join, then enter this code.
                    </span>
                    <button
                      type="button"
                      className="play-code-dismiss"
                      aria-label="Hide join code"
                      onClick={() => setCodeHiddenFor(online.code)}
                    >
                      <X width={16} height={16} strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                )}
                <OnlineBoardDoor
                  game={online}
                  decks={decks}
                  userId={user?.id ?? null}
                  onlineBoards={onlineBoards}
                  dispatchOnline={dispatchOnline}
                />
                {/* No boardVisible gating here — minimize/show-board is a
                    local-game concept; navigating away from Online is just
                    switching tabs (T99). */}
                <OnlineGameView
                  game={online}
                  errorMessage={onlineError}
                  onEnd={() => setPendingEnd('online')}
                  onLeave={() => void leaveOnline()}
                  onRematch={() => {
                    rematchLocal(gameToRematch(online));
                    setTab('local');
                  }}
                />
              </>
            )
          ) : isGuest ? (
            <div className="empty-state">
              <p className="empty-state-tagline">Online games need an account.</p>
              <p className="empty-state-hint">
                Sign in to host or join a multiplayer game so other players can sync to it. Local
                games work without an account.
              </p>
              <div className="empty-state-actions">
                <Link to={signInHref} className="btn btn-primary">
                  Sign in
                </Link>
              </div>
            </div>
          ) : (
            <>
              <OnlineSetup
                key={onlineMode}
                decks={decks}
                onHost={(opts) =>
                  void hostOnline(opts).catch((err) =>
                    toast.show({
                      message: userMessage(
                        err,
                        "Couldn't create the game. Check your connection and try again."
                      ),
                      tone: 'error',
                    })
                  )
                }
                onJoin={(code, opts) =>
                  void joinOnline(code, opts).catch((err) =>
                    toast.show({
                      message: userMessage(
                        err,
                        "Couldn't join that game. Check the code and try again."
                      ),
                      tone: 'error',
                    })
                  )
                }
                onWatch={(code) =>
                  void watchOnline(code).catch((err) =>
                    toast.show({
                      // A table that has not opened itself to watchers reads
                      // exactly like a code that does not exist, on purpose —
                      // so this one message covers both.
                      message: userMessage(
                        err,
                        "That game isn't open to watch. Check the code, or ask the host to allow watchers."
                      ),
                      tone: 'error',
                    })
                  )
                }
                defaultName={user?.username ?? ''}
                hasActive={!!online}
                initialMode={onlineMode}
              />
            </>
          )}
        </>
      )}

      {tab === 'nights' && (
        <GameNightsTab
          isGuest={isGuest}
          nights={gameNights.nights}
          loading={gameNights.loading}
          error={gameNights.error}
          refresh={gameNights.refresh}
        />
      )}

      {tab === 'history' && (
        <HistoryTab
          history={history}
          userId={user?.id ?? null}
          onRematch={(rec) => {
            rematchLocal(recordToRematch(rec));
            setTab('local');
          }}
        />
      )}

      {pendingEnd && (
        <EndGameDialog
          game={pendingEnd === 'local' ? local : online}
          onConfirm={(winnerSeat) => {
            if (pendingEnd === 'local') endLocal(winnerSeat);
            else void dispatchOnline({ type: 'end', winnerSeat });
            setPendingEnd(null);
          }}
          onCancel={() => setPendingEnd(null)}
        />
      )}

      {pendingDiscard && (
        <ConfirmDialog
          title="Discard this game?"
          body="The current game will be removed without saving to history."
          confirmLabel="Discard"
          danger
          onConfirm={() => {
            discardLocal();
            setPendingDiscard(false);
          }}
          onCancel={() => setPendingDiscard(false)}
        />
      )}

      {pendingStart && (
        <ConfirmDialog
          title="Start a new game?"
          body="You have a game in progress. Starting a new one discards it without saving to history."
          confirmLabel="Start new game"
          danger
          onConfirm={() => {
            startLocal(pendingStart);
            setPendingStart(null);
          }}
          onCancel={() => setPendingStart(null)}
        />
      )}
    </div>
  );
}

// ── Local setup ─────────────────────────────────────────────────────────────

function LocalSetup({
  decks,
  onStart,
  hasActive,
}: {
  decks: Deck[];
  onStart: (setup: LocalGameSetup) => void;
  hasActive: boolean;
}) {
  // A game night's "Start game" captures a one-shot seed (players + format) in
  // the store before navigating here. Read it once at mount — via a lazy
  // useState initializer rather than an effect, so seeding the form's initial
  // values never needs a setState call inside a useEffect body — then clear it
  // so switching tabs and back doesn't reseed over the user's edits.
  const [seed] = useState(() => usePlayStore.getState().gameNightSeed);
  useEffect(() => {
    if (seed) usePlayStore.getState().clearGameSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [format, setFormat] = useState<GameFormat>(seed?.format ?? 'commander');
  const formatCfg = FORMAT_OPTIONS.find((f) => f.value === format) ?? FORMAT_OPTIONS[0];
  const [startingLife, setStartingLife] = useState<number>(formatCfg.defaultLife);
  const [commanderDamageEnabled, setCmdDmg] = useState<boolean>(formatCfg.cmdDmg);
  const [poisonEnabled, setPoison] = useState<boolean>(false);
  const [count, setCount] = useState<number>(() =>
    seed && seed.players.length > 0
      ? Math.max(MIN_LOCAL_PLAYERS, Math.min(seed.players.length, MAX_LOCAL_PLAYERS))
      : MIN_LOCAL_PLAYERS
  );
  // Empty, not a live "Player N" value — the placeholder already shows that
  // suggestion, and a real seeded value (only `name` matters is used
  // instead) means typing over it can't concatenate into "Player 1Alice"
  // (B7-05).
  const [players, setPlayers] = useState<LocalGameSetup['players']>(() =>
    Array.from({ length: MAX_LOCAL_PLAYERS }, (_, i) => seededPlayer(seed?.players[i]))
  );

  // Seats are people. Signed in, the form knows who "you" are and can seat
  // friends and whole pods; a guest's table is names only, as before.
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);
  const me: SeatPerson | null = user
    ? { id: user.id, username: user.username, displayName: profile?.displayName ?? null }
    : null;
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [pods, setPods] = useState<Pod[]>([]);
  const [seatingPod, setSeatingPod] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listFriends()
      .then((list) => {
        if (cancelled) return;
        setFriends(list);
        // A game night seeds handles, not ids (its RSVPs never carry account
        // ids). Now that the list is here, seat the account behind each
        // handle so the game credits them; a handle nobody recognises stays
        // a guest.
        setPlayers((prev) =>
          prev.map((p) => {
            if (p.userId || !p.username) return p;
            const who =
              p.username === user.username ? user : list.find((f) => f.username === p.username);
            return who ? { ...p, userId: who.id } : p;
          })
        );
      })
      .catch(() => {
        // No friends list ≠ no form: seats stay guests until it loads.
        if (!cancelled) setFriends([]);
      });
    listPods()
      .then((list) => {
        if (!cancelled) setPods(list.filter((p) => p.myStatus === 'member'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  /** Fill the roster with a pod's members — you first, then the rest. */
  async function seatPod(pod: Pod) {
    if (!me || seatingPod) return;
    setSeatingPod(pod.id);
    try {
      const detail = await getPod(pod.id);
      const members = detail.members.filter((m) => m.status === 'member');
      const ordered = [
        ...members.filter((m) => m.userId === me.id),
        ...members.filter((m) => m.userId !== me.id),
      ];
      const seated = ordered.slice(0, MAX_LOCAL_PLAYERS);
      const next = Array.from({ length: MAX_LOCAL_PLAYERS }, (_, i) => {
        const m = seated[i];
        if (!m) return blankPlayer('');
        const person: SeatPerson =
          m.userId === me.id
            ? me
            : (friends?.find((f) => f.id === m.userId) ?? {
                id: m.userId,
                username: m.username,
                displayName: null,
              });
        return {
          ...blankPlayer(formatIdentity(person).primary),
          userId: person.id,
          username: person.username,
        };
      });
      setPlayers(next);
      setCount(Math.max(MIN_LOCAL_PLAYERS, seated.length));
      if (ordered.length > seated.length) {
        toast.show({
          message: `Seated the first ${MAX_LOCAL_PLAYERS} of ${pod.name}. The rest need a second table.`,
        });
      }
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't load that pod's roster. Try again in a moment."),
        tone: 'error',
      });
    } finally {
      setSeatingPod(null);
    }
  }
  // Free-form counter names every seat starts with. Empty for most tables;
  // a pod that always tracks energy sets it once and saves it in a profile.
  const [counters, setCounters] = useState<string[]>([]);
  const [counterDraft, setCounterDraft] = useState('');

  /** The form's current values as a startable setup. Shared by submit and by
   *  "save as profile", so a saved profile is exactly what would have run. */
  function buildSetup(): LocalGameSetup {
    return {
      format,
      startingLife,
      commanderDamageEnabled,
      poisonEnabled,
      counters,
      players: players
        .slice(0, count)
        .map((p, i) => ({ ...p, name: p.name.trim() || `Player ${i + 1}` })),
    };
  }

  /** Load a profile over the form. A genuine reset: every field is replaced,
   *  including the seats beyond the profile's own count, so nothing from the
   *  previous setup survives underneath. */
  function applySetup(setup: LocalGameSetup) {
    setFormat(setup.format);
    setStartingLife(setup.startingLife);
    setCmdDmg(setup.commanderDamageEnabled);
    setPoison(setup.poisonEnabled);
    setCounters(setup.counters ?? []);
    setCounterDraft('');
    const next = Math.max(MIN_LOCAL_PLAYERS, Math.min(setup.players.length, MAX_LOCAL_PLAYERS));
    setCount(next);
    setPlayers(
      Array.from({ length: MAX_LOCAL_PLAYERS }, (_, i) => setup.players[i] ?? blankPlayer(''))
    );
  }

  function addCounter() {
    const name = counterDraft.replace(/\s+/g, ' ').trim().slice(0, MAX_COUNTER_NAME_LENGTH);
    if (!name) return;
    setCounters((prev) =>
      prev.some((c) => c.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name]
    );
    setCounterDraft('');
  }

  function applyFormat(next: GameFormat) {
    const cfg = FORMAT_OPTIONS.find((f) => f.value === next) ?? FORMAT_OPTIONS[0];
    setFormat(next);
    setStartingLife(cfg.defaultLife);
    setCmdDmg(cfg.cmdDmg);
  }

  function setPlayer(i: number, patch: Partial<LocalGameSetup['players'][number]>) {
    setPlayers((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function addPlayer() {
    if (count >= MAX_LOCAL_PLAYERS) return;
    setCount((c) => Math.min(c + 1, MAX_LOCAL_PLAYERS));
  }

  function removePlayer(index: number) {
    if (count <= MIN_LOCAL_PLAYERS) return;
    // Shift names down so the visible seats stay 1..N after the splice,
    // then drop the last seat.
    setPlayers((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      next.push(blankPlayer(''));
      return next;
    });
    setCount((c) => Math.max(c - 1, MIN_LOCAL_PLAYERS));
  }

  return (
    <form
      className="play-setup play-setup-form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(buildSetup());
      }}
    >
      <header className="play-setup-header">
        <h2 className="play-setup-title">
          {hasActive ? 'Start a different game' : 'New local game'}
        </h2>
      </header>

      <TableProfiles current={buildSetup} onLoad={applySetup} />

      <section className="play-setup-game" aria-labelledby="play-setup-game-label">
        <h3 id="play-setup-game-label" className="play-setup-section-title">
          Game
        </h3>
        <div className="play-setup-row" style={{ marginTop: '0.5rem' }}>
          <div className="play-field play-field-inline">
            <span>Format</span>
            <SelectMenu<GameFormat>
              ariaLabel="Format"
              value={format}
              onChange={applyFormat}
              options={FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
            />
          </div>

          <div className="play-field play-field-inline">
            <span id="starting-life-label">Starting life</span>
            <Stepper
              value={startingLife}
              min={1}
              max={200}
              step={5}
              ariaLabelledBy="starting-life-label"
              onChange={setStartingLife}
            />
          </div>
        </div>
      </section>

      <section className="play-setup-rules" aria-labelledby="play-setup-rules-label">
        <h3 id="play-setup-rules-label" className="play-setup-section-title">
          Rules
        </h3>
        <RulePill
          on={commanderDamageEnabled}
          onChange={setCmdDmg}
          label="Commander damage"
          hint="Lose at 21 combat damage from a single commander."
        />
        <RulePill
          on={poisonEnabled}
          onChange={setPoison}
          label="Poison counters"
          hint="Lose at 10 poison counters."
        />

        {/* Free-form counters every seat starts with. Nothing here is a rule:
            these never cause a loss, they are just what this table counts. */}
        <div className="play-setup-counters">
          <span id="setup-counters-label" className="play-setup-counters-label">
            Counters on every seat
          </span>
          {counters.length > 0 && (
            <ul className="play-setup-counter-chips" aria-labelledby="setup-counters-label">
              {counters.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="play-setup-counter-chip"
                    aria-label={`Remove ${name}`}
                    onClick={() => setCounters((prev) => prev.filter((c) => c !== name))}
                  >
                    {name}
                    <span aria-hidden="true">✕</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {counters.length < MAX_COUNTERS_PER_SCOPE && (
            <div className="play-setup-counter-add">
              <input
                className="play-setup-counter-input"
                value={counterDraft}
                onChange={(e) => setCounterDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter inside a form submits it, which would start the
                  // game instead of adding the counter.
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  addCounter();
                }}
                maxLength={MAX_COUNTER_NAME_LENGTH}
                placeholder="Energy"
                aria-label="New counter name"
              />
              <button
                type="button"
                className="play-setup-counter-btn"
                disabled={!counterDraft.trim()}
                onClick={addCounter}
              >
                Add
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="play-setup-roster" aria-label="Players">
        <header className="play-setup-roster-head">
          <h3 className="play-setup-section-title">Players</h3>
          <span className="play-setup-roster-count">{count}</span>
        </header>
        {me && pods.length > 0 && (
          <div className="play-setup-pods" role="group" aria-label="Seat a pod">
            <span className="play-setup-pods-label">Seat a pod</span>
            {pods.map((pod) => (
              <button
                key={pod.id}
                type="button"
                className="pill-btn play-setup-pod-btn"
                disabled={seatingPod !== null}
                aria-busy={seatingPod === pod.id}
                onClick={() => void seatPod(pod)}
              >
                {pod.name}
              </button>
            ))}
          </div>
        )}
        <ul className="play-setup-roster-list">
          {players.slice(0, count).map((p, i) => (
            <li key={i} className="play-setup-seat">
              <span className="play-setup-seat-num" aria-hidden="true">
                {i + 1}
              </span>
              {me && (
                <SeatWho
                  seatIndex={i}
                  value={p.userId ?? null}
                  me={me}
                  friends={friends ?? []}
                  taken={
                    new Set(
                      players
                        .slice(0, count)
                        .filter((q, idx) => idx !== i && q.userId)
                        .map((q) => q.userId as string)
                    )
                  }
                  onChange={(person) =>
                    setPlayer(
                      i,
                      person
                        ? {
                            userId: person.id,
                            username: person.username,
                            name: formatIdentity(person).primary,
                          }
                        : { userId: null, username: null }
                    )
                  }
                />
              )}
              <input
                className="play-setup-seat-name"
                value={p.name}
                onChange={(e) => setPlayer(i, { name: e.target.value })}
                maxLength={40}
                aria-label={`Player ${i + 1} name`}
                placeholder={`Player ${i + 1}`}
              />
              <SeatPips ci={p.colorIdentity} />
              <SeatDeck
                decks={decks}
                value={p.deckId}
                deckName={p.deckName}
                onChange={(picked) =>
                  setPlayer(i, {
                    deckId: picked?.id ?? null,
                    deckName: picked?.name ?? null,
                    commander: picked?.commander ?? null,
                    // Decks already model the second commander, so a Partner
                    // seat splits its damage counter with no setup step —
                    // nobody stops mid-game to type in a commander name.
                    partner: picked?.partner ?? null,
                    colorIdentity: picked?.colorIdentity ?? [],
                  })
                }
              />
              {count > MIN_LOCAL_PLAYERS && (
                <button
                  type="button"
                  className="play-setup-seat-remove"
                  aria-label={`Remove ${p.name || `Player ${i + 1}`}`}
                  onClick={() => removePlayer(i)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {count < MAX_LOCAL_PLAYERS && (
          <button
            type="button"
            className="play-setup-roster-add"
            onClick={addPlayer}
            aria-label="Add player"
          >
            + Add player
          </button>
        )}
      </section>

      <button type="submit" className="btn btn-primary play-setup-start">
        <Swords width={16} height={16} strokeWidth={2} aria-hidden />
        Start game
      </button>
    </form>
  );
}

// ── Sub-components: stepper, rule pill, per-seat deck affordance ──────────

function SeatDeck({
  decks,
  value,
  deckName,
  onChange,
}: {
  decks: Deck[];
  value: string | null;
  deckName: string | null;
  onChange: (picked: PickedDeck | null) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open && !value) {
    return (
      <button
        type="button"
        className="play-setup-seat-deck-add"
        onClick={() => setOpen(true)}
        aria-label="Add deck"
      >
        + Deck
      </button>
    );
  }
  return (
    <div className="play-setup-seat-deck">
      <DeckPicker decks={decks} value={value} valueName={deckName} onChange={onChange} />
      {value && deckName && (
        <button
          type="button"
          className="play-setup-seat-deck-clear"
          aria-label="Clear deck"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function blankPlayer(name: string): LocalGameSetup['players'][number] {
  return {
    name,
    userId: null,
    username: null,
    deckId: null,
    deckName: null,
    commander: null,
    partner: null,
    colorIdentity: [],
  };
}

/** A seat from a game night's seed: the name now, the account once friends load. */
function seededPlayer(seed: SeatSeed | undefined): LocalGameSetup['players'][number] {
  return { ...blankPlayer(seed?.name ?? ''), username: seed?.username ?? null };
}

/** Someone who can hold a seat: the signed-in user or one of their friends. */
interface SeatPerson {
  id: string;
  username: string;
  displayName: string | null;
}

const SEAT_GUEST = '__guest__';

/**
 * Who sits here: a guest (a name, no account — most seats at most tables),
 * you, or a friend. Picking an account fills the name with how they present
 * themselves and credits their record when the game ends; the name stays
 * editable because a table has its own nicknames. An account already in
 * another seat isn't offered twice.
 */
function SeatWho({
  seatIndex,
  value,
  me,
  friends,
  taken,
  onChange,
}: {
  seatIndex: number;
  value: string | null;
  me: SeatPerson;
  friends: Friend[];
  taken: Set<string>;
  onChange: (person: SeatPerson | null) => void;
}) {
  const people: SeatPerson[] = [me, ...friends];
  const options = [
    { value: SEAT_GUEST, label: 'Guest' },
    ...people
      .filter((p) => p.id === value || !taken.has(p.id))
      .map((p) => ({
        value: p.id,
        label: p.id === me.id ? 'You' : formatIdentity(p).primary,
      })),
  ];
  return (
    <SelectMenu<string>
      ariaLabel={`Who is in seat ${seatIndex + 1}`}
      className="play-setup-seat-who"
      value={value ?? SEAT_GUEST}
      options={options}
      onChange={(next) =>
        onChange(next === SEAT_GUEST ? null : (people.find((p) => p.id === next) ?? null))
      }
    />
  );
}

// ── Online setup ────────────────────────────────────────────────────────────

function OnlineSetup({
  decks,
  onHost,
  onJoin,
  onWatch,
  defaultName,
  hasActive,
  initialMode,
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
    }
  ) => void;
  onWatch: (code: string) => void;
  defaultName: string;
  hasActive: boolean;
  /** Which form opens first — the dashboard's doors pick one. */
  initialMode?: 'host' | 'join';
}) {
  const [mode, setMode] = useState<'host' | 'join'>(initialMode ?? 'host');
  const [format, setFormat] = useState<GameFormat>('commander');
  const [name, setName] = useState(defaultName);
  const [deck, setDeck] = useState<PickedDeck | null>(null);
  const [code, setCode] = useState('');

  // The format decides the table's opening rules; the host tunes them in the
  // lobby afterwards, so they are derived here rather than held as state.
  const cfg = FORMAT_OPTIONS.find((f) => f.value === format) ?? FORMAT_OPTIONS[0];
  const startingLife = cfg.defaultLife;
  const commanderDamageEnabled = cfg.cmdDmg;
  const poisonEnabled = false;

  function applyFormat(next: GameFormat) {
    setFormat(next);
  }

  return (
    <div className="play-setup play-setup--online">
      <Tabs<'host' | 'join'>
        ariaLabel="Online game mode"
        value={mode}
        onChange={setMode}
        variant="fitted"
        className="play-online-mode-tabs"
        tabs={[
          { id: 'host', label: 'Host' },
          { id: 'join', label: 'Join' },
        ]}
      />

      {mode === 'host' ? (
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
            });
          }}
        >
          <header className="play-setup-header">
            <h2 className="play-setup-title">
              {hasActive ? 'Host a different game' : 'Host a game'}
            </h2>
            <p className="play-setup-help">
              You'll get a 4-character code. Share it with friends so they can join from their own
              devices.
              {hasActive && ' Hosting a new game will leave the one you have minimized.'}
            </p>
          </header>

          {/* Format alone: it sets the defaults for everything else, and
              every other table rule (life, commander damage, poison, the
              mulligan, the timer) belongs in the lobby, where the pod can see
              and argue about it. Asking twice was the old shape. */}
          <section className="play-setup-row play-setup-game">
            <div className="play-field play-field-inline">
              <span>Format</span>
              <SelectMenu<GameFormat>
                ariaLabel="Format"
                value={format}
                onChange={applyFormat}
                options={FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
              />
            </div>
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

          <button type="submit" className="btn btn-primary play-setup-start">
            <Swords width={16} height={16} strokeWidth={2} aria-hidden />
            Create game
          </button>
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
            });
          }}
        >
          <header className="play-setup-header">
            <h2 className="play-setup-title">Join a game</h2>
            <p className="play-setup-help">
              Enter the 4-character code shared by the host, then pick your name and deck.
            </p>
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

          <button
            type="submit"
            className="btn btn-primary play-setup-start"
            disabled={code.trim().length < 3}
          >
            <Swords width={16} height={16} strokeWidth={2} aria-hidden />
            Join game
          </button>
          {/* Watching needs the code and nothing else — no name, no deck, no
              seat. It only works on a table whose host switched watchers on;
              otherwise the read comes back as if the code were unknown, and
              the error says so. */}
          <button
            type="button"
            className="btn play-setup-watch"
            disabled={code.trim().length < 3}
            onClick={() => onWatch(code.trim().toUpperCase())}
          >
            <Eye width={16} height={16} strokeWidth={2} aria-hidden />
            Watch without a seat
          </button>
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
function OnlineBoardDoor({
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
        <Link
          to={deckBoardPath(mine.deckId)}
          className={`btn play-board-door-cta ${urgent ? 'btn-primary' : ''}`}
        >
          {myBoardOpen ? 'Back to your board' : 'Open your board'}
        </Link>
      )}
    </section>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

type HistoryFilter = 'all' | 'local' | 'online';

/**
 * Whether the × may remove this record. A local game is deletable by the
 * device that holds it (a guest's device-only record) or the account that
 * posted it; an online game is the table's shared record and nobody's to
 * remove. A record read back from the server without a recorder is the same.
 */
function canRemoveRecord(rec: GameRecord, userId: string | null): boolean {
  if (rec.mode !== 'local') return false;
  if (userId === null) return true;
  return rec.recordedByUserId === undefined || rec.recordedByUserId === userId;
}

function HistoryTab({
  history,
  userId,
  onRematch,
}: {
  history: GameRecord[];
  userId: string | null;
  onRematch: (rec: GameRecord) => void;
}) {
  const removeHistory = usePlayStore((s) => s.removeHistory);
  // The × sits on every row of a list a thumb scrolls past, and a removed
  // record is gone for good (no undo) — so it asks first, like every other
  // destructive exit on this page.
  const [pendingRemove, setPendingRemove] = useState<GameRecord | null>(null);
  // Both modes live in one list on purpose (one record per game, wherever it
  // was played); the filter is how you look at just one of them.
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const shown = useMemo(
    () => (filter === 'all' ? history : history.filter((r) => r.mode === filter)),
    [history, filter]
  );
  const deckRows = useMemo(() => aggregateDeckRecords(shown, userId), [shown, userId]);
  const matchupRows = useMemo(() => aggregateMatchupRecords(shown, userId), [shown, userId]);
  const hasBothModes =
    history.some((r) => r.mode === 'local') && history.some((r) => r.mode === 'online');

  // Authed users always get the server-authoritative Friends leaderboard, even
  // before any games are recorded.
  if (history.length === 0 && userId === null) {
    return (
      <div className="empty-state">
        <EmptyStateMark />
        <p className="empty-state-tagline">No games yet.</p>
        <p className="empty-state-hint">Pick a door on the Play tab to start your first game.</p>
      </div>
    );
  }

  return (
    <div className="play-history">
      {userId !== null && <FriendsLeaderboard />}
      {history.length === 0 && (
        <div className="empty-state">
          <EmptyStateMark />
          <p className="empty-state-tagline">No games yet.</p>
          <p className="empty-state-hint">Pick a door on the Play tab to start your first game.</p>
        </div>
      )}
      {hasBothModes && (
        <Tabs<HistoryFilter>
          ariaLabel="Which games"
          variant="fitted"
          className="play-history-filter"
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'all', label: 'All games' },
            { id: 'local', label: 'Local' },
            { id: 'online', label: 'Online' },
          ]}
        />
      )}
      {deckRows.length > 0 && (
        <section className="play-records">
          <h2 className="play-records-title">Deck win-loss</h2>
          <table className="play-records-table">
            <thead>
              <tr>
                <th scope="col">Deck</th>
                <th scope="col">Played</th>
                <th scope="col">W</th>
                <th scope="col">L</th>
                <th scope="col">Win %</th>
                <th scope="col">Last played</th>
              </tr>
            </thead>
            <tbody>
              {deckRows.map((row) => (
                <tr key={row.deckId}>
                  <td>{row.deckName}</td>
                  <td>{row.played}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{(row.winRate * 100).toFixed(0)}%</td>
                  <td>{new Date(row.lastPlayedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {matchupRows.length > 0 && (
        <section className="play-records">
          <h2 className="play-records-title">Head-to-head</h2>
          <table className="play-records-table">
            <thead>
              <tr>
                <th scope="col">Deck A</th>
                <th scope="col" className="play-matchup-vs">
                  vs
                </th>
                <th scope="col">Deck B</th>
                <th scope="col">Played</th>
                <th scope="col">W</th>
                <th scope="col">L</th>
                <th scope="col">W/L</th>
                <th scope="col">Win%</th>
                <th scope="col">Last played</th>
              </tr>
            </thead>
            <tbody>
              {matchupRows.map((row) => (
                <tr key={`${row.deckAId}|${row.deckBId}`}>
                  <td>{row.deckAName}</td>
                  <td className="play-matchup-vs">vs</td>
                  <td>{row.deckBName}</td>
                  <td>{row.played}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td className="play-matchup-bar">
                    <StackedBar
                      segments={[
                        { key: 'w', value: row.wins, color: 'var(--success)' },
                        { key: 'l', value: row.losses, color: 'var(--err-text)' },
                      ]}
                      max={row.played}
                    />
                  </td>
                  <td>{(row.winRate * 100).toFixed(0)}%</td>
                  <td>{new Date(row.lastPlayedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section className="play-records">
        <h2 className="play-records-title">Games</h2>
        {shown.length === 0 && history.length > 0 && (
          <p className="empty-state-hint">No {filter} games yet.</p>
        )}
        <ul className="play-history-list">
          {shown.map((rec) => {
            const winner =
              rec.winnerSeat != null ? rec.players.find((p) => p.seat === rec.winnerSeat) : null;
            return (
              <li key={rec.id} className="play-history-item">
                <div className="play-history-head">
                  <span className="play-history-format">{rec.format}</span>
                  <span className="play-history-mode">{rec.mode}</span>
                  <span className="play-history-date">
                    {new Date(rec.endedAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className="play-history-rematch"
                    aria-label={`Rematch: ${new Date(rec.endedAt).toLocaleString()}`}
                    onClick={() => onRematch(rec)}
                  >
                    Rematch
                  </button>
                  {canRemoveRecord(rec, userId) && (
                    <button
                      type="button"
                      className="play-history-remove"
                      aria-label={`Remove game: ${new Date(rec.endedAt).toLocaleString()}`}
                      onClick={() => setPendingRemove(rec)}
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="play-history-winner">
                  {winner ? `Winner: ${winner.name}` : 'No winner recorded'}
                  {rec.durationMs > 0 && (
                    <span className="play-history-duration">
                      {' '}
                      · {Math.round(rec.durationMs / 60000)} min
                    </span>
                  )}
                </div>
                <ol className="play-history-players">
                  {rec.players.map((p) => (
                    <li key={p.seat} className={p.seat === rec.winnerSeat ? 'is-winner' : ''}>
                      <span className="play-history-player-name">{p.name}</span>
                      {p.deckName && <span className="play-history-player-deck">{p.deckName}</span>}
                      <span className="play-history-player-life">
                        {p.finalLife} life {p.eliminated ? '· eliminated' : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      </section>
      {pendingRemove && (
        <ConfirmDialog
          title="Remove this game?"
          body="It leaves your history and the deck records built from it. This can't be undone."
          confirmLabel="Remove"
          danger
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            removeHistory(pendingRemove.id);
            setPendingRemove(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Banner shown on the Play tab when there's an active game but the board is
 * minimized. Lets the user resume into the fullscreen view or discard.
 */
function ResumeBanner({
  game,
  onResume,
  onDiscard,
}: {
  game: { players: GamePlayer[]; status: string; mode: 'local' | 'online'; code: string };
  onResume: () => void;
  onDiscard: () => void;
}) {
  const summary = game.players.map((p) => p.name).join(' · ');
  return (
    <section className="play-resume-banner" aria-label="Active game">
      <div className="play-resume-banner-body">
        <span className="play-resume-banner-label">
          {game.mode === 'online' ? `Online game ${game.code}` : 'Local game'}
          <span className="play-resume-banner-status"> · {game.status}</span>
        </span>
        <span className="play-resume-banner-players">{summary}</span>
      </div>
      <div className="play-resume-banner-actions">
        <button type="button" className="btn btn-primary" onClick={onResume}>
          Resume
        </button>
        <button type="button" className="btn" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </section>
  );
}
