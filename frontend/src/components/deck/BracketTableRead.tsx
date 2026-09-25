import './BracketBreakdown.css';
import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { usePlayStore } from '../../store/play';
import { deckTableRead, TABLE_READ_MIN_GAMES } from '@/lib/table-read';
import { MeterBar } from '../shared/MeterBar';

const READ_COPY = {
  above:
    'It wins much more than an even share, so it may play above the tables you take it to. Say so before the game.',
  even: 'It wins about its share, so it fits the tables you take it to.',
  below: 'It wins well under an even share, so it may play below the tables you take it to.',
} as const;

function wins(n: number, games: number): string {
  return `${n} ${n === 1 ? 'win' : 'wins'} in ${games} ${games === 1 ? 'game' : 'games'}`;
}

/**
 * "At the table" in the Bracket panel: how the deck actually does, beside the
 * estimate. Tracked games against an even share of wins (one over the pod
 * size per game). Evidence only: it never moves the estimate, and the
 * opponents' brackets are unknown, so the copy doesn't claim a bracket.
 */
export function BracketTableRead({ deckId }: { deckId: string }): JSX.Element {
  const userId = useAuth((s) => s.user?.id ?? null);
  const history = usePlayStore((s) => s.history);
  const read = useMemo(() => deckTableRead(history, userId, deckId), [history, userId, deckId]);

  return (
    <div className="bracket-breakdown-section bracket-table-read">
      <h4 className="bracket-breakdown-heading">At the table</h4>
      {read.games === 0 ? (
        <p className="bracket-table-read-note">
          No tracked games with this deck.{' '}
          <Link to="/play" className="bracket-table-read-link">
            Track a game <span aria-hidden="true">›</span>
          </Link>
        </p>
      ) : (
        <>
          <p className="bracket-table-read-head">
            <strong>{wins(read.wins, read.games)}</strong>
            {read.verdict && (
              <span className="bracket-table-read-even">
                an even share is {read.evenShare.toFixed(1)}
              </span>
            )}
          </p>
          {read.verdict ? (
            <>
              <MeterBar
                value={read.wins}
                max={read.games}
                tick={read.evenShare}
                label={`${wins(read.wins, read.games)}; an even share is ${read.evenShare.toFixed(1)}`}
              />
              <p className={`bracket-table-read-note is-${read.verdict}`}>
                {READ_COPY[read.verdict]}
              </p>
            </>
          ) : (
            <p className="bracket-table-read-note">
              Too few games to say much. {TABLE_READ_MIN_GAMES - read.games} more{' '}
              {TABLE_READ_MIN_GAMES - read.games === 1 ? 'game gives' : 'games give'} a read.
            </p>
          )}
        </>
      )}
    </div>
  );
}
