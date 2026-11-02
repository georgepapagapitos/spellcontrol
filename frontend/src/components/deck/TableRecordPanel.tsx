import './TableRecordPanel.css';
import { type JSX, useMemo } from 'react';
import { useAuth } from '../../store/auth';
import { aggregateDeckRecords, usePlayStore } from '../../store/play';
import { aggregateMatchupRecords } from '@/lib/play/matchup-records';
import { DECK_RATE_MIN_GAMES, deckPilots, formatRate } from '@/lib/play/deck-stats';
import { StackedBar } from '../shared/MeterBar';
import { Button } from '@/components/shared/Button';
import type { Deck } from '@/store/decks';
import type { ClockCard } from '@/lib/mana-sim/opening-hand-sim';
import type { SpeedPath } from '@/lib/mana-sim/speed-path';
import { DeckOutcomeRead } from './DeckOutcomeRead';

interface TableRecordPanelProps {
  deckId: string;
  /** With the deck and its clock inputs the panel also sets the forecast
   *  beside the games played with the list the deck holds now. */
  outcome?: {
    deck: Deck;
    clockLibrary: readonly ClockCard[];
    speedPath: SpeedPath | null;
  };
}

/**
 * "Table record" — this deck's real tracked W/L, sourced from the same
 * aggregation used by the Play/History tab (`aggregateDeckRecords` /
 * `aggregateMatchupRecords`). Physical games only; no theoretical grade.
 */
export function TableRecordPanel({ deckId, outcome }: TableRecordPanelProps): JSX.Element {
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

  const pilots = useMemo(() => deckPilots(history, deckId, userId), [history, deckId, userId]);

  // A lone pilot is the record above, said twice, unless that pilot is
  // someone else's: a signed-in deck that only ever sat in a borrower's seat.
  const showPilots = pilots.length > 1 || (userId !== null && pilots.some((p) => !p.isYou));

  if (!deckRow) {
    return (
      // A sub-panel placeholder, not a page's empty state (§ Empty states): one
      // line and a quiet door. The headline-plus-primary-button version stood
      // taller than any real panel beside it, for a deck that simply hasn't
      // been played yet.
      <div className="table-record-empty">
        <p className="table-record-empty-text">
          No games tracked yet. Log one to see wins, losses and who beat this deck.
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
        {deckRow.losses}L{undecided > 0 ? ` · ${undecided} no winner` : ''}
        {' · '}
        {deckRow.wins + deckRow.losses >= DECK_RATE_MIN_GAMES
          ? `${formatRate(deckRow.wins, deckRow.losses)} win rate`
          : `win rate after ${DECK_RATE_MIN_GAMES} games with a winner`}
        <br />
        Last played {new Date(deckRow.lastPlayedAt).toLocaleDateString()}
      </p>

      {/* Only when someone besides you sat behind it: a lone pilot is the
          record above, said twice. */}
      {showPilots && (
        <ul className="table-record-matchups" aria-label="Who piloted this deck">
          {pilots.map((p) => (
            <li key={p.key} className="table-record-matchup-row">
              <span className="table-record-matchup-opponent">{p.isYou ? 'You' : p.name}</span>
              <span className="table-record-matchup-score">
                {p.played} {p.played === 1 ? 'game' : 'games'} · {p.wins}–{p.losses}
                {p.wins + p.losses >= DECK_RATE_MIN_GAMES
                  ? ` · ${formatRate(p.wins, p.losses)}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

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
      {outcome && (
        <DeckOutcomeRead
          deck={outcome.deck}
          history={history}
          userId={userId}
          clockLibrary={outcome.clockLibrary}
          speedPath={outcome.speedPath}
        />
      )}
    </div>
  );
}
