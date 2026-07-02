import './TableRecordPanel.css';
import { type JSX, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { aggregateDeckRecords, usePlayStore } from '../../store/play';
import { aggregateMatchupRecords } from '@/lib/matchup-records';
import { StackedBar } from '../shared/MeterBar';

interface TableRecordPanelProps {
  deckId: string;
}

/**
 * "Table record" — this deck's real tracked W/L, sourced from the same
 * aggregation used by the Play/History tab (`aggregateDeckRecords` /
 * `aggregateMatchupRecords`). Physical games only; no theoretical grade.
 */
export function TableRecordPanel({ deckId }: TableRecordPanelProps): JSX.Element {
  const userId = useAuth((s) => s.user?.id ?? null);
  const history = usePlayStore((s) => s.history);

  const deckRow = useMemo(
    () => aggregateDeckRecords(history, userId).find((r) => r.deckId === deckId) ?? null,
    [history, userId, deckId]
  );
  const matchups = useMemo(
    () =>
      aggregateMatchupRecords(history, userId)
        .filter((r) => r.deckAId === deckId || r.deckBId === deckId)
        .slice(0, 3),
    [history, userId, deckId]
  );

  if (!deckRow) {
    return (
      <div className="empty-state table-record-empty">
        <p className="empty-state-tagline">No games tracked yet.</p>
        <p className="empty-state-hint">Track a game to see this deck's real record.</p>
        <div className="empty-state-actions">
          <Link to="/play" className="btn btn-primary">
            Track a game
          </Link>
        </div>
      </div>
    );
  }

  const undecided = deckRow.played - deckRow.wins - deckRow.losses;

  return (
    <div className="table-record">
      <StackedBar
        segments={[
          { key: 'w', value: deckRow.wins, color: 'var(--success)' },
          { key: 'l', value: deckRow.losses, color: 'var(--err-text)' },
          { key: 'u', value: undecided, color: 'var(--border)' },
        ]}
        max={deckRow.played}
        size="md"
      />
      <p className="table-record-summary">
        {deckRow.played} {deckRow.played === 1 ? 'game' : 'games'} · {deckRow.wins}W–
        {deckRow.losses}L{undecided > 0 ? ` · ${undecided} no winner` : ''} ·{' '}
        {(deckRow.winRate * 100).toFixed(0)}% win rate
        <br />
        Last played {new Date(deckRow.lastPlayedAt).toLocaleDateString()}
      </p>

      {matchups.length > 0 && (
        <ul className="table-record-matchups">
          {matchups.map((m) => {
            const isA = m.deckAId === deckId;
            const oppName = isA ? m.deckBName : m.deckAName;
            const oppId = isA ? m.deckBId : m.deckAId;
            const wins = isA ? m.wins : m.losses;
            const losses = isA ? m.losses : m.wins;
            return (
              <li key={oppId} className="table-record-matchup-row">
                <span className="table-record-matchup-opponent">{oppName}</span>
                <StackedBar
                  segments={[
                    { key: 'w', value: wins, color: 'var(--success)' },
                    { key: 'l', value: losses, color: 'var(--err-text)' },
                  ]}
                  max={m.played}
                  className="table-record-matchup-bar"
                />
                <span className="table-record-matchup-score">
                  {wins}–{losses}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
