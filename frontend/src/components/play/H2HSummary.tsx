import './H2HSummary.css';
import { StackedBar } from '../shared/MeterBar';
import { formatIdentity } from '../../lib/display-name';
import type { H2HResponse } from '../../lib/game-results-client';

/**
 * Shared "You X – Y @friend over N games" summary bar + deck-matchup table.
 * Reused by the friends leaderboard's expandable detail row and the
 * friend-hub head-to-head strip — one visual language for H2H data.
 */
export function H2HSummary({ data }: { data: H2HResponse }) {
  const { summary } = data;
  // Prose, not a row/label — a "@handle" reads awkwardly mid-sentence, so this
  // uses the primary name only, no secondary form.
  const friendName = formatIdentity(data.friend).primary;
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
          You {summary.callerWins} – {summary.friendWins} {friendName} over {summary.gamesPlayed}{' '}
          game{summary.gamesPlayed === 1 ? '' : 's'}
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
