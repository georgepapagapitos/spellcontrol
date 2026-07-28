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

      <H2HRivalry summary={summary} friendName={friendName} />

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

/**
 * The rivalry line — who draws blood, who finishes higher, who actually
 * removes whom. Renders nothing when `ratedGames` is 0 or absent: that means
 * no game in this pairing carries a derived summary (all pre-migration, or an
 * older backend), and showing a row of honest-looking zeroes would be a lie.
 */
function H2HRivalry({
  summary,
  friendName,
}: {
  summary: H2HResponse['summary'];
  friendName: string;
}) {
  if (!summary.ratedGames) return null;
  const place = (n: number | null | undefined) => (n != null ? n.toFixed(1) : '—');
  return (
    <dl className="h2h-rivalry" aria-label={`Rivalry stats over ${summary.ratedGames} games`}>
      <div>
        <dt>First blood</dt>
        <dd>
          You <b>{summary.callerFirstBlood ?? 0}</b> · {friendName}{' '}
          <b>{summary.friendFirstBlood ?? 0}</b>
        </dd>
      </div>
      <div>
        <dt>Avg place</dt>
        <dd>
          You <b>{place(summary.callerAvgPlacement)}</b> · {friendName}{' '}
          <b>{place(summary.friendAvgPlacement)}</b>
        </dd>
      </div>
      <div>
        <dt>Knockouts</dt>
        <dd>
          You <b>{summary.callerKos ?? 0}</b> · {friendName} <b>{summary.friendKos ?? 0}</b>
        </dd>
      </div>
    </dl>
  );
}
