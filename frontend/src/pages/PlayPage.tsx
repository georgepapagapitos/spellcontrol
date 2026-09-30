// The play table's stylesheets ship with this chunk, not the boot payload
// (E265) — same relative order as the former main.tsx block.
import '@/styles/play-fonts.css';
import '@/styles/play-setup.css';
import '@/styles/play-board.css';
import '@/styles/play-panel-menus.css';
import '@/styles/play-history-inline.css';
import '@/styles/play-effects.css';
import '@/styles/play-enhancements.css';
import '@/styles/play-layout-editor.css';
import '@/styles/play-counters-panel.css';
import { EmptyState } from '@/components/shared/EmptyState';
import { Check, Copy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSignInPath } from '@/lib/account/sign-in-path';
import { useAuth } from '@/store/auth';
import { useDecksStore } from '@/store/decks';
import { gameToRematch, recordToRematch, usePlayStore, type LocalGameSetup } from '@/store/play';
import { toast } from '@/store/toasts';
import { GameBoard } from '@/components/play/GameBoard';
import { EndGameDialog } from '@/components/play/EndGameDialog';
import { OnlineGameView } from '@/components/play/OnlineGameView';
import { OnlineLobby } from '@/components/play/OnlineLobby';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import { HubPage } from '@/components/app-shell/HubPage';
import { GameNightsTab, pendingInviteCount, useGameNights } from '@/components/play/GameNights';
import { FORMAT_OPTIONS, MIN_LOCAL_PLAYERS } from '@/lib/play/game-formats';
import { deckBoardPath } from '@/lib/play/starter-decks';
import type { GamePlayer, GameRecord } from '@/lib/play/game-state';
import { useCopyFeedback } from '@/lib/util/use-copy-feedback';
import { gameToRecord } from '@/lib/play/game-state';
import { userMessage } from '@/lib/util/user-error';
import { PlayHome, type PlayHomeTarget } from '@/components/play/PlayHome';
import { HordeTable } from '@/components/play/horde/HordeTable';
import { HordeResumeBanner } from '@/components/play/horde/HordeResumeBanner';
import { useHordeGameStore } from '@/store/horde-game';
import { Button, IconButton } from '@/components/shared/Button';
import { LocalSetup } from './play/LocalSetup';
import { OnlineSetup, OnlineBoardDoor } from './play/OnlineSetup';
import { HistoryTab } from './play/HistoryTab';
import { blankPlayer } from './play/seat-players';
type Tab = 'home' | 'local' | 'online' | 'nights' | 'history';
const TABS: ReadonlySet<string> = new Set(['home', 'local', 'online', 'nights', 'history']);
const SECTION_LABEL: Record<Tab, string> = {
  home: 'Play',
  local: 'Local',
  online: 'Online',
  nights: 'Game nights',
  history: 'History',
};

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

  const hordeConfig = useHordeGameStore((s) => s.config);
  const hordeBoardVisible = useHordeGameStore((s) => s.boardVisible);

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

  // The section is the route, not a query param (E375) — real routes are
  // deep-linkable/bookmarkable the way the other three hubs already are, and
  // deriving `tab` fresh every render (instead of the old mount-only
  // useState) fixes browser back/forward across Play's tabs for free.
  const { section } = useParams<{ section?: string }>();
  // The pre-E375 address, `/play?tab=nights`, still arrives from bookmarks
  // and old links (the nightly journey kept visiting it and shot the Play
  // home three times over). It renders its tab at once, and the mount effect
  // below moves the address to the real route.
  const legacyTab = section ? null : params.get('tab');
  const tab: Tab =
    section && TABS.has(section)
      ? (section as Tab)
      : legacyTab && TABS.has(legacyTab)
        ? (legacyTab as Tab)
        : 'home';
  const setTab = (t: Tab) => {
    navigate(t === 'home' ? '/play' : `/play/${t}`);
  };
  // A dashboard door that opens Online can also say which form: host or join.
  const openFromHome = (target: PlayHomeTarget) => {
    const path = `/play/${target.tab}`;
    navigate(target.tab === 'online' && target.mode ? `${path}?mode=${target.mode}` : path);
  };
  const onlineMode: 'host' | 'join' | 'browse' =
    params.get('mode') === 'join' ? 'join' : params.get('mode') === 'browse' ? 'browse' : 'host';

  // Landing on bare /play: the table you're in the middle of (a board on
  // screen, or a live online seat) wins over the dashboard, so a refresh or a
  // fresh visit mid-game goes straight back to it instead of making you click
  // through Home again. Only on the very first mount — a deliberate
  // navigation back to /play while already at the table (e.g. the Play nav
  // link) is honored literally, not redirected away from again.
  useEffect(() => {
    if (section) return;
    if (legacyTab && TABS.has(legacyTab)) {
      const rest = new URLSearchParams(params);
      rest.delete('tab');
      const query = rest.toString();
      navigate(
        `${legacyTab === 'home' ? '/play' : `/play/${legacyTab}`}${query ? `?${query}` : ''}`,
        {
          replace: true,
        }
      );
      return;
    }
    if (params.get('new') === '1') return;
    if (local && boardVisible) {
      navigate('/play/local', { replace: true });
      return;
    }
    if (online) navigate('/play/online', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link from the landing page's "Start a game" door (`/play?new=1`):
  // start a table on arrival, so the promise is one tap rather than a tap plus
  // a form. The values are exactly what an untouched LocalSetup would submit,
  // so the door and the form can never disagree. The param is stripped with
  // `replace` first — before any early return — so a refresh or a Back never
  // restarts a game, and an already-running game always wins over the deep
  // link rather than being silently clobbered (it still lands on Local either
  // way, matching what the landing page promised).
  useEffect(() => {
    if (params.get('new') !== '1') return;
    setParams(
      (p) => {
        p.delete('new');
        return p;
      },
      { replace: true }
    );
    if (!usePlayStore.getState().local) {
      const fmt = FORMAT_OPTIONS[0];
      startLocal({
        format: fmt.value,
        startingLife: fmt.defaultLife,
        commanderDamageEnabled: fmt.cmdDmg,
        poisonEnabled: false,
        players: Array.from({ length: MIN_LOCAL_PLAYERS }, (_, i) =>
          blankPlayer(`Player ${i + 1}`)
        ),
      });
    }
    navigate('/play/local', { replace: true });
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
  // A Horde rematch from History while another Horde fight is still going:
  // starting it would discard that fight, so it asks first.
  const [pendingHordeRematch, setPendingHordeRematch] = useState<GameRecord | null>(null);
  // One rematch for a finished game, from History and from a finished online
  // table alike: a Horde game comes back as a Horde fight, not a plain life
  // counter, and only an unfinished fight is worth asking about. The online
  // table used to rebuild a 40-life counter out of a Horde game (E446).
  const rematchRecord = (rec: GameRecord) => {
    if (rec.format === 'horde') {
      const horde = useHordeGameStore.getState();
      if (horde.config && horde.phase !== 'ended') {
        setPendingHordeRematch(rec);
        return;
      }
      void horde.rematch(rec);
    } else {
      rematchLocal(recordToRematch(rec));
    }
    setTab('local');
  };
  // Starting a new local game while one is active overwrites it; hold the setup
  // here and confirm first instead of silently discarding the in-progress game.
  const [pendingStart, setPendingStart] = useState<LocalGameSetup | null>(null);
  // Which game's join-code banner the host dismissed. Keyed by code so a new
  // game's banner shows again without an effect to reset it.
  const [codeHiddenFor, setCodeHiddenFor] = useState<string | null>(null);
  const {
    copied: codeCopied,
    announcement: codeCopyAnnouncement,
    copy: copyJoinCode,
  } = useCopyFeedback({ what: 'the code' });

  const handleStartLocal = (setup: LocalGameSetup) => {
    if (local) setPendingStart(setup);
    else startLocal(setup);
  };

  return (
    <HubPage
      hub="play"
      section={SECTION_LABEL[tab]}
      className="play-page"
      intro={
        tab === 'home'
          ? 'Track a table in person, or play across devices with a join code.'
          : undefined
      }
      counts={{ '/play/nights': inviteCount }}
    >
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
          {hordeConfig && hordeBoardVisible ? (
            <HordeTable />
          ) : local && boardVisible ? (
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
              {hordeConfig && <HordeResumeBanner />}
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
                      aria-label="Copy join code"
                      onClick={() => copyJoinCode(online.code)}
                    >
                      {codeCopied ? (
                        <>
                          <Check width={14} height={14} strokeWidth={1.8} aria-hidden /> Copied
                        </>
                      ) : (
                        <>
                          <Copy width={14} height={14} strokeWidth={1.8} aria-hidden /> Copy
                        </>
                      )}
                    </button>
                    <span className="sr-only copy-feedback-announce" aria-live="polite">
                      {codeCopyAnnouncement}
                    </span>
                    <span className="play-code-hint">
                      Players go to Play → Online → Join, then enter this code.
                    </span>
                    <IconButton
                      className="play-code-dismiss"
                      onClick={() => setCodeHiddenFor(online.code)}
                      label="Hide join code"
                      icon={<X width={16} height={16} strokeWidth={2} />}
                    />
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
                  onRematch={() => rematchRecord(gameToRecord(online))}
                />
              </>
            )
          ) : isGuest ? (
            <EmptyState
              tagline="Online games need an account."
              hint="Sign in to host or join online. Local games work without an account."
              actions={
                <Button variant="primary" to={signInHref}>
                  Sign in
                </Button>
              }
            />
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
                initialCode={params.get('code') ?? undefined}
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
        <HistoryTab history={history} userId={user?.id ?? null} onRematch={rematchRecord} />
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

      {pendingHordeRematch && (
        <ConfirmDialog
          title="Start a new Horde fight?"
          body="The Horde fight in progress will be removed without saving to history."
          confirmLabel="Start the rematch"
          danger
          onConfirm={() => {
            void useHordeGameStore.getState().rematch(pendingHordeRematch);
            setPendingHordeRematch(null);
            setTab('local');
          }}
          onCancel={() => setPendingHordeRematch(null)}
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
    </HubPage>
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
        <Button variant="primary" onClick={onResume}>
          Resume
        </Button>
        <Button onClick={onDiscard}>Discard</Button>
      </div>
    </section>
  );
}
