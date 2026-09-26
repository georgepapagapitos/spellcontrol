import './TableRecordPanel.css';
import { type JSX, useMemo } from 'react';
import { useAuth } from '../../store/auth';
import { aggregateDeckRecords, usePlayStore } from '../../store/play';
import { aggregateMatchupRecords } from '@/lib/matchup-records';
import { StackedBar } from '../shared/MeterBar';
import { Button } from '@/components/shared/Button';

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
      // A sub-panel placeholder, not a page's empty state (§ Empty states): one
      // line and a quiet door. The headline-plus-primary-button version stood
      // taller than any real panel beside it, for a deck that simply hasn't
      // been played yet.
      <div className="table-record-empty">
        <p className="table-record-empty-text">
          No games tracked yet. Log one and this shows wins, losses and who beat it.
        </p>
        <Button to="/play">Track a game</Button>
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
