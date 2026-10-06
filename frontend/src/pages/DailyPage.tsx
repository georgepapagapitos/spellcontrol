import './DailyPage.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { Button } from '@/components/shared/Button';
import { useSealMoment } from '@/components/shared/SealMoment';
import { ClueList } from '@/components/daily/ClueList';
import { DailyFriendsPanel } from '@/components/daily/DailyFriendsPanel';
import { DailyResultPanel } from '@/components/daily/DailyResultPanel';
import { DailyStatsPanel } from '@/components/daily/DailyStatsPanel';
import { GuessGrid } from '@/components/daily/GuessGrid';
import { GuessInput } from '@/components/daily/GuessInput';
import {
  dailyArtUrl,
  fetchDailyFriends,
  fetchMyDailyResults,
  playDaily,
  postDailyResults,
  type DailyFriend,
  type DailyState,
} from '@/lib/daily/daily-client';
import { loadDailyNames, type DailyNames } from '@/lib/daily/names';
import { buildShareText } from '@/lib/daily/share';
import { computeStats } from '@/lib/daily/stats';
import { userMessage } from '@/lib/util/user-error';
import { useAuth } from '@/store/auth';
import { useDailyStore } from '@/store/daily';

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; daily: DailyState };

type Friends =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; friends: DailyFriend[] };

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * `/daily`: one card a day, the same for everyone (E558). The server picks the
 * card, scores each guess, hands out only the clues a player has earned and
 * blurs the art itself, so nothing in the browser names the answer until the
 * day is done. Signed in, the server keeps the guesses; a guest's live on the
 * device and are sent with each move.
 */
export function DailyPage() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [names, setNames] = useState<DailyNames | null>(null);
  const authStatus = useAuth((s) => s.status);
  const signedIn = authStatus === 'authed';
  const settled = authStatus === 'authed' || authStatus === 'guest';

  const results = useDailyStore((s) => s.results);
  const { addGuess, finish, adoptServerResults, markPosted } = useDailyStore.getState();

  const { fire, moment } = useSealMoment();
  const [friends, setFriends] = useState<Friends>({ kind: 'loading' });

  const daily = load.state === 'ready' ? load.daily : null;
  const today = daily?.date ?? null;

  // A guest's guesses for the server's day. Signed in, the server already has them.
  const guestGuesses = useCallback(
    (date: string | null) => (date ? (useDailyStore.getState().guesses[date] ?? []) : []),
    []
  );

  const recordFinish = useCallback(
    (state: DailyState) => {
      if (state.status === 'playing') return;
      finish(
        state.date,
        {
          solved: state.status === 'solved',
          guesses: state.status === 'solved' ? state.guesses.length : state.maxGuesses,
        },
        { queue: !signedIn }
      );
    },
    [finish, signedIn]
  );

  // State is set only when the load settles, so the effect never sets state
  // synchronously; Retry shows the skeleton first, then fetches.
  const fetchState = useCallback(() => {
    // The server's day is the UTC day, so a guest's list for it is keyed the
    // same way. Never another day's list: it would replay against today's card.
    const utcToday = new Date().toISOString().slice(0, 10);
    playDaily(signedIn ? {} : { guesses: guestGuesses(utcToday) })
      .then((state) => {
        recordFinish(state);
        setLoad({ state: 'ready', daily: state });
      })
      .catch((err: unknown) =>
        setLoad({ state: 'error', message: userMessage(err, "Couldn't load today's card.") })
      );
  }, [signedIn, guestGuesses, recordFinish]);

  useEffect(() => {
    if (settled) fetchState();
  }, [settled, fetchState]);

  useEffect(() => {
    loadDailyNames()
      .then(setNames)
      .catch(() => setNames(null));
  }, []);

  const retry = () => {
    setLoad({ state: 'loading' });
    fetchState();
  };

  const loadFriends = useCallback((date: string) => {
    setFriends({ kind: 'loading' });
    fetchDailyFriends(date)
      .then((list) => setFriends({ kind: 'ready', friends: list }))
      .catch((err: unknown) =>
        setFriends({
          kind: 'error',
          message: userMessage(err, "Couldn't load your friends' results."),
        })
      );
  }, []);

  // Signed in: hand the account a guest's past days it hasn't seen (today's is
  // recorded as you play, so it's never posted), then read back its history.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!signedIn || !today || syncedRef.current) return;
    syncedRef.current = true;
    const { results: local, unposted } = useDailyStore.getState();
    const toPost = local.filter((r) => unposted.includes(r.date) && r.date < today);
    const posted = toPost.length
      ? postDailyResults(toPost)
          .then(() => markPosted(toPost.map((r) => r.date)))
          .catch(() => undefined)
      : Promise.resolve();
    void posted
      .then(() => fetchMyDailyResults())
      .then(adoptServerResults)
      .catch(() => undefined);
    loadFriends(today);
  }, [signedIn, today, loadFriends, markPosted, adoptServerResults]);

  const finished = daily ? daily.status !== 'playing' : false;
  const stats = useMemo(() => (today ? computeStats(results, today) : null), [results, today]);

  const move = async (body: { guess?: string; giveUp?: boolean }): Promise<string | null> => {
    if (!daily) return null;
    try {
      const next = await playDaily(
        signedIn ? body : { guesses: guestGuesses(daily.date), ...body }
      );
      if (!signedIn && body.guess) {
        const last = next.guesses.at(-1);
        if (last) addGuess(next.date, last.name);
      }
      recordFinish(next);
      setLoad({ state: 'ready', daily: next });
      if (next.status === 'solved' && next.answer) fire(next.answer.colors.split(''));
      if (next.status !== 'playing' && signedIn) loadFriends(next.date);
      return null;
    } catch (err) {
      return userMessage(err, "Couldn't send that guess.");
    }
  };

  // Giving up ends the day and the streak, so it asks once, inline.
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false);
  const giveUp = () => {
    setConfirmingGiveUp(false);
    void move({ giveUp: true });
  };

  const meta = daily
    ? [
        `#${daily.number}`,
        dayLabel(daily.date),
        daily.status === 'solved'
          ? `Solved in ${daily.guesses.length}`
          : daily.status === 'failed'
            ? 'Not solved'
            : `Guess ${Math.min(daily.guesses.length + 1, daily.maxGuesses)} of ${daily.maxGuesses}`,
      ].join(' · ')
    : undefined;

  const shareText =
    daily && finished && daily.guesses.length > 0
      ? buildShareText({
          number: daily.number,
          solved: daily.status === 'solved',
          maxGuesses: daily.maxGuesses,
          guesses: daily.guesses,
          url: `${window.location.origin}/daily`,
        })
      : null;

  const left = daily ? daily.maxGuesses - daily.guesses.length : 0;
  const todayResult = today ? (results.find((r) => r.date === today) ?? null) : null;

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

      {daily && (
        <div className="daily-play">
          <div className="daily-art-col">
            <div className="daily-art">
              {finished && daily.answer ? (
                <img src={daily.answer.art} alt={`Art from ${daily.answer.name}`} />
              ) : (
                <img
                  className="is-blurred"
                  src={dailyArtUrl(daily.date, daily.artLevel ?? 0)}
                  alt="Today's card art, blurred"
                />
              )}
            </div>
            {!finished && <p className="daily-art-note">The art sharpens with each miss.</p>}
          </div>
          <div className="daily-guess-col">
            {finished && daily.answer ? (
              <DailyResultPanel
                answer={daily.answer}
                solved={daily.status === 'solved'}
                guesses={daily.status === 'solved' ? daily.guesses.length : daily.maxGuesses}
                shareText={shareText}
                streak={stats?.streak ?? 0}
              />
            ) : (
              <>
                <h2 className="daily-section-title">Name the card</h2>
                <GuessInput
                  names={names}
                  guessed={daily.guesses.map((g) => g.name)}
                  onGuess={(name) => move({ guess: name })}
                />
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
                      {left} {left === 1 ? 'guess' : 'guesses'} left
                    </span>
                    <Button variant="link" onClick={() => setConfirmingGiveUp(true)}>
                      Give up
                    </Button>
                  </div>
                )}
              </>
            )}
            <GuessGrid guesses={daily.guesses} />
          </div>
          <div className="daily-clue-col">
            <h2 className="daily-section-title">Clues</h2>
            <ClueList clues={daily.clues} total={daily.maxGuesses} playing={!finished} />
          </div>
        </div>
      )}

      {daily && stats && (
        <div className="daily-panels">
          <DailyStatsPanel
            stats={stats}
            todayGuesses={todayResult?.solved ? todayResult.guesses : null}
          />
          {signedIn ? (
            friends.kind === 'error' ? (
              <DailyFriendsPanel
                kind="error"
                message={friends.message}
                onRetry={() => loadFriends(daily.date)}
              />
            ) : friends.kind === 'loading' ? (
              <DailyFriendsPanel kind="loading" />
            ) : (
              <DailyFriendsPanel kind="ready" friends={friends.friends} />
            )
          ) : (
            <DailyFriendsPanel kind="guest" />
          )}
        </div>
      )}
    </div>
  );
}
