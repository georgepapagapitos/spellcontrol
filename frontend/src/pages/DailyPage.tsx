import './DailyPage.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { useSealMoment } from '@/components/shared/SealMoment';
import { ClueList } from '@/components/daily/ClueList';
import { DailyFriendsPanel } from '@/components/daily/DailyFriendsPanel';
import { DailyResultPanel } from '@/components/daily/DailyResultPanel';
import { DailyStatsPanel } from '@/components/daily/DailyStatsPanel';
import { GuessGrid, type ScoredGuess } from '@/components/daily/GuessGrid';
import { GuessInput } from '@/components/daily/GuessInput';
import { loadCardIndex, type DailyCardIndex } from '@/lib/daily/cards-index';
import {
  fetchDailyFriends,
  fetchMyDailyResults,
  postDailyResults,
  type DailyFriend,
} from '@/lib/daily/daily-client';
import { loadSchedule, puzzleFor, todayUtc, type DailyPuzzle } from '@/lib/daily/schedule';
import { scoreGuess, type CardAttrs } from '@/lib/daily/score';
import { buildShareText } from '@/lib/daily/share';
import { computeStats, MAX_GUESSES } from '@/lib/daily/stats';
import { userMessage } from '@/lib/util/user-error';
import { useAuth } from '@/store/auth';
import { useDailyStore } from '@/store/daily';

// The art starts unreadable and sharpens with each miss; clear once finished.
const BLUR_PX = [18, 13, 9, 6, 3, 1.5];

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; puzzle: DailyPuzzle | null; index: DailyCardIndex };

type Friends =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; friends: DailyFriend[] };

function answerOf(p: DailyPuzzle): CardAttrs {
  return {
    name: p.name,
    colors: p.colors,
    mv: p.mv,
    typeLine: p.typeLine,
    rarity: p.rarity,
    year: p.year,
  };
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * `/daily`: one card a day, the same for everyone (E558). Guests play with their
 * results on this device; signed in, results reach the server (which keeps the
 * first per day) and friends' scores show beside yours.
 */
export function DailyPage() {
  // ponytail: the day is fixed at mount; a page left open past UTC midnight
  // keeps yesterday's card until reload. Add a midnight rollover if people notice.
  const [today] = useState(() => todayUtc());
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const authStatus = useAuth((s) => s.status);
  const signedIn = authStatus === 'authed';

  const guessNames = useDailyStore((s) => s.guesses[today]);
  const results = useDailyStore((s) => s.results);
  const { addGuess, finish, adoptServerResults, markPosted } = useDailyStore.getState();

  const { fire, moment } = useSealMoment();
  const [friends, setFriends] = useState<Friends>({ kind: 'loading' });

  // State is set only when the load settles, so the mount effect never sets
  // state synchronously; Retry shows the skeleton first, then fetches.
  const fetchPuzzle = useCallback(() => {
    Promise.all([loadSchedule(), loadCardIndex()])
      .then(([schedule, index]) =>
        setLoad({ state: 'ready', puzzle: puzzleFor(schedule, today), index })
      )
      .catch((err: unknown) =>
        setLoad({ state: 'error', message: userMessage(err, "Couldn't load today's card.") })
      );
  }, [today]);

  useEffect(fetchPuzzle, [fetchPuzzle]);

  const retry = () => {
    setLoad({ state: 'loading' });
    fetchPuzzle();
  };

  const loadFriends = useCallback(() => {
    setFriends({ kind: 'loading' });
    fetchDailyFriends(today)
      .then((list) => setFriends({ kind: 'ready', friends: list }))
      .catch((err: unknown) =>
        setFriends({
          kind: 'error',
          message: userMessage(err, "Couldn't load your friends' results."),
        })
      );
  }, [today]);

  // Signed in: hand the server anything it hasn't confirmed (a guest's history
  // on first sign-in, or a post that failed), then read back the account's own
  // history. The server keeps the first result per day, so the order matters.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!signedIn || syncedRef.current) return;
    syncedRef.current = true;
    const { results: local, unposted: pending } = useDailyStore.getState();
    const toPost = local.filter((r) => pending.includes(r.date));
    const posted = toPost.length
      ? postDailyResults(toPost)
          .then(() => markPosted(toPost.map((r) => r.date)))
          .catch(() => undefined)
      : Promise.resolve();
    void posted
      .then(() => fetchMyDailyResults())
      .then(adoptServerResults)
      .catch(() => undefined);
    loadFriends();
  }, [signedIn, loadFriends, markPosted, adoptServerResults]);

  const ready = load.state === 'ready' ? load : null;
  const puzzle = ready?.puzzle ?? null;
  const todayResult = results.find((r) => r.date === today) ?? null;
  const finished = todayResult !== null;

  const scored: ScoredGuess[] = useMemo(() => {
    if (!ready || !puzzle) return [];
    const answer = answerOf(puzzle);
    return (guessNames ?? []).flatMap((name) => {
      const card = ready.index.get(name);
      return card ? [{ card, score: scoreGuess(card, answer) }] : [];
    });
  }, [ready, puzzle, guessNames]);

  const misses = scored.filter((g) => g.card.name !== puzzle?.name).length;
  const stats = useMemo(() => computeStats(results, today), [results, today]);

  const record = (solved: boolean, guesses: number) => {
    finish(today, { solved, guesses });
    if (!signedIn) return;
    postDailyResults([{ date: today, solved, guesses }])
      .then(() => {
        markPosted([today]);
        loadFriends();
      })
      .catch(() => undefined);
  };

  const onGuess = (name: string) => {
    if (!puzzle || finished) return;
    addGuess(today, name);
    const count = (useDailyStore.getState().guesses[today] ?? []).length;
    if (name === puzzle.name) {
      record(true, count);
      fire(puzzle.colors.split(''));
    } else if (count >= MAX_GUESSES) {
      record(false, MAX_GUESSES);
    }
  };

  // Giving up ends the day and the streak, so it asks once, inline.
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false);
  const giveUp = () => {
    setConfirmingGiveUp(false);
    if (puzzle && !finished) record(false, MAX_GUESSES);
  };

  const meta = puzzle
    ? [
        `#${puzzle.number}`,
        dayLabel(today),
        finished
          ? todayResult.solved
            ? `Solved in ${todayResult.guesses}`
            : 'Not solved'
          : `Guess ${Math.min(scored.length + 1, MAX_GUESSES)} of ${MAX_GUESSES}`,
      ].join(' · ')
    : undefined;

  const shareText =
    finished && puzzle && scored.length > 0
      ? buildShareText({
          number: puzzle.number,
          solved: todayResult.solved,
          scores: scored.map((g) => g.score),
          url: `${window.location.origin}/daily`,
        })
      : null;

  return (
    <div className="daily-page">
      {moment}
      <PageHeader title="Daily" titleId="daily-page-title" meta={meta} />

      {load.state === 'loading' && (
        <div className="daily-skeleton" role="status" aria-label="Loading" aria-busy="true">
          <div className="daily-skeleton-art" aria-hidden="true" />
          <div className="daily-skeleton-side" aria-hidden="true" />
        </div>
      )}

      {load.state === 'error' && (
        <div className="daily-load-error" role="alert">
          <span>{load.message}</span>
          <Button onClick={retry}>Retry</Button>
        </div>
      )}

      {ready && !puzzle && (
        <EmptyState tagline="No card today." hint="The next one arrives at midnight UTC." />
      )}

      {ready && puzzle && (
        <div className="daily-play">
          <div className="daily-art-col">
            <div className="daily-art">
              <img
                src={puzzle.art}
                alt={finished ? `Art from ${puzzle.name}` : "Today's card art, blurred"}
                style={{
                  filter: finished
                    ? 'none'
                    : `blur(${BLUR_PX[Math.min(misses, BLUR_PX.length - 1)]}px)`,
                }}
              />
            </div>
            {!finished && <p className="daily-art-note">The art sharpens with each miss.</p>}
          </div>
          <div className="daily-guess-col">
            {finished ? (
              <DailyResultPanel
                puzzle={puzzle}
                solved={todayResult.solved}
                guesses={todayResult.guesses}
                shareText={shareText}
                streak={stats.streak}
              />
            ) : (
              <>
                <h2 className="daily-section-title">Name the card</h2>
                <GuessInput index={ready.index} guessed={guessNames ?? []} onGuess={onGuess} />
                {confirmingGiveUp ? (
                  <div className="daily-guess-foot" role="group" aria-label="Give up today's card">
                    <span>Give up? Your streak ends and today's card is revealed.</span>
                    <span className="daily-guess-foot-actions">
                      <Button variant="danger" onClick={giveUp}>
                        Give up
                      </Button>
                      <Button onClick={() => setConfirmingGiveUp(false)}>Keep playing</Button>
                    </span>
                  </div>
                ) : (
                  <div className="daily-guess-foot">
                    <span>
                      {MAX_GUESSES - scored.length}{' '}
                      {MAX_GUESSES - scored.length === 1 ? 'guess' : 'guesses'} left
                    </span>
                    <Button variant="link" onClick={() => setConfirmingGiveUp(true)}>
                      Give up
                    </Button>
                  </div>
                )}
              </>
            )}
            <GuessGrid guesses={scored} />
          </div>
          <div className="daily-clue-col">
            <h2 className="daily-section-title">Clues</h2>
            <ClueList
              puzzle={puzzle}
              unlocked={finished ? MAX_GUESSES : Math.min(MAX_GUESSES, misses + 1)}
              playing={!finished}
            />
          </div>
        </div>
      )}

      {ready && (
        <div className="daily-panels">
          <DailyStatsPanel
            stats={stats}
            todayGuesses={todayResult?.solved ? todayResult.guesses : null}
          />
          {signedIn ? (
            friends.kind === 'error' ? (
              <DailyFriendsPanel kind="error" message={friends.message} onRetry={loadFriends} />
            ) : friends.kind === 'loading' ? (
              <DailyFriendsPanel kind="loading" />
            ) : (
              <DailyFriendsPanel kind="ready" friends={friends.friends} />
            )
          ) : authStatus === 'guest' ? (
            <DailyFriendsPanel kind="guest" />
          ) : null}
        </div>
      )}
    </div>
  );
}
