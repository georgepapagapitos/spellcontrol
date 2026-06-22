import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StackedBar } from '../shared/MeterBar';
import {
  fetchLeaderboard,
  fetchH2H,
  type LeaderboardEntry,
  type H2HResponse,
} from '../../lib/game-results-client';
import './FriendsLeaderboard.css';

/**
 * Server-authoritative "Friends leaderboard": W/L over online games you played
 * with each friend, expandable to a head-to-head detail. Social data is fetched
 * online (not via the local-first sync queue), refreshed on tab focus.
 */
export function FriendsLeaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchLeaderboard()
      .then((rows) => {
        setEntries(rows);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [load]);

  if (error) {
    return (
      <section className="play-records">
        <h2 className="play-records-title">Friends leaderboard</h2>
        <p className="leaderboard-error" role="alert">
          Couldn’t load friend records.{' '}
          <button type="button" className="link-button" onClick={load}>
            Retry
          </button>
        </p>
      </section>
    );
  }

  if (entries === null) {
    return (
      <section className="play-records">
        <h2 className="play-records-title">Friends leaderboard</h2>
        <div className="leaderboard-skeleton" aria-label="Loading" aria-busy="true" />
      </section>
    );
  }

  if (entries.length === 0) {
    return (
      <section className="play-records">
        <h2 className="play-records-title">Friends leaderboard</h2>
        <p className="leaderboard-empty">
          Play online games with friends to see head-to-head records.{' '}
          <Link to="/friends">Add friends</Link>.
        </p>
      </section>
    );
  }

  return (
    <section className="play-records">
      <h2 className="play-records-title">Friends leaderboard</h2>
      <table className="play-records-table">
        <thead>
          <tr>
            <th>Friend</th>
            <th>Played</th>
            <th>You</th>
            <th>Them</th>
            <th>W/L</th>
            <th>Last played</th>
            <th aria-label="Expand" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const isOpen = expanded === e.friendId;
            return (
              <Fragment key={e.friendId}>
                <tr>
                  <td>{e.friendUsername}</td>
                  <td>{e.gamesPlayed}</td>
                  <td>{e.callerWins}</td>
                  <td>{e.friendWins}</td>
                  <td className="play-matchup-bar">
                    <StackedBar
                      segments={[
                        { key: 'w', value: e.callerWins, color: 'var(--success)' },
                        { key: 'l', value: e.friendWins, color: 'var(--err-text)' },
                      ]}
                      max={e.gamesPlayed}
                    />
                  </td>
                  <td>{new Date(e.lastPlayedAt).toLocaleDateString()}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : e.friendId)}
                    >
                      {isOpen ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${e.friendId}-detail`}>
                    <td colSpan={7} className="leaderboard-detail-cell">
                      <H2HDetail friendId={e.friendId} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function H2HDetail({ friendId }: { friendId: string }) {
  const [data, setData] = useState<H2HResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // friendId is fixed per mounted instance (the detail row unmounts on
    // collapse), so initial null state already covers the reset.
    let live = true;
    fetchH2H(friendId)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [friendId]);

  if (error) {
    return (
      <p className="leaderboard-error" role="alert">
        Couldn’t load head-to-head.
      </p>
    );
  }
  if (!data) {
    return <div className="leaderboard-skeleton" aria-label="Loading" aria-busy="true" />;
  }

  const { summary } = data;
  return (
    <div className="h2h-detail">
      <div className="h2h-summary">
        <StackedBar
          segments={[
            { key: 'w', value: summary.callerWins, color: 'var(--success)' },
            { key: 'l', value: summary.friendWins, color: 'var(--err-text)' },
          ]}
          max={summary.gamesPlayed}
        />
        <span className="h2h-summary-label">
          You {summary.callerWins} – {summary.friendWins} {data.friend.username} over{' '}
          {summary.gamesPlayed} game{summary.gamesPlayed === 1 ? '' : 's'}
        </span>
      </div>

      {summary.deckMatchups.length > 0 && (
        <table className="play-records-table h2h-matchups">
          <thead>
            <tr>
              <th>Your deck</th>
              <th>Their deck</th>
              <th>You</th>
              <th>Them</th>
              <th>Played</th>
            </tr>
          </thead>
          <tbody>
            {summary.deckMatchups.map((m, i) => (
              <tr key={i}>
                <td>{m.callerDeckName ?? '—'}</td>
                <td>{m.friendDeckName ?? '—'}</td>
                <td>{m.callerWins}</td>
                <td>{m.friendWins}</td>
                <td>{m.played}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
