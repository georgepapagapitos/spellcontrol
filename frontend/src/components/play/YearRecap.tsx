import { useMemo, useState } from 'react';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { Surface } from '@/components/shared/Surface';
import { gameFormatLabel } from '@/lib/play/game-formats';
import { DECK_RATE_MIN_GAMES, formatRate } from '@/lib/play/deck-stats';
import { buildYearRecap, recapYears, type RecapGame } from '@/lib/play/year-recap';
import './YearRecap.css';

/** "2h 5m" / "42 min": elapsed spans, not wall-clock ages. */
function span(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

/**
 * A year of one group's games: how many, which decks and players carried
 * them, the longest. The games handed in are the whole universe: a pod's own
 * games or one account's history, never a wider corpus. A win rate shows only
 * from DECK_RATE_MIN_GAMES decided games, so a 1-0 deck does not top the list.
 *
 * Renders nothing when there is no game to recap; the caller's own empty
 * state already says so and a second one here would only repeat it.
 */
export function YearRecap({
  games,
  title = 'Year in review',
  capNote,
}: {
  games: RecapGame[];
  title?: string;
  /** Set when the list holds only the most recent games (a fetch ceiling). */
  capNote?: string;
}) {
  const years = useMemo(() => recapYears(games), [games]);
  const [picked, setPicked] = useState<number | null>(null);
  const year = picked !== null && years.includes(picked) ? picked : years[0];
  const recap = useMemo(
    () => (year === undefined ? null : buildYearRecap(games, year)),
    [games, year]
  );
  if (!recap || year === undefined) return null;

  return (
    <Surface as="section" variant="framed" className="year-recap" aria-label={`${title} ${year}`}>
      <div className="year-recap-head">
        <h2 className="year-recap-title">{title}</h2>
        {years.length > 1 ? (
          <SelectMenu<number>
            ariaLabel="Year"
            value={year}
            options={years.map((y) => ({ value: y, label: String(y) }))}
            onChange={setPicked}
          />
        ) : (
          <span className="year-recap-year">{year}</span>
        )}
      </div>

      <dl className="year-recap-figures">
        <div>
          <dt>Games</dt>
          <dd>{recap.games}</dd>
        </div>
        <div>
          <dt>Players</dt>
          <dd>{recap.players}</dd>
        </div>
        <div>
          <dt>Time at the table</dt>
          <dd>{recap.totalMs > 0 ? span(recap.totalMs) : '—'}</dd>
        </div>
      </dl>

      {recap.mostPlayed.length > 0 && (
        <section className="year-recap-block" aria-label="Most played decks">
          <h3 className="year-recap-sub">Most played decks</h3>
          <div className="year-recap-scroll">
            <table className="play-records-table">
              <thead>
                <tr>
                  <th scope="col">Deck</th>
                  <th scope="col">Played</th>
                  <th scope="col">W–L</th>
                  <th scope="col">Win %</th>
                </tr>
              </thead>
              <tbody>
                {recap.mostPlayed.map((d) => (
                  <tr key={d.deckId}>
                    <td>{d.deckName}</td>
                    <td>{d.played}</td>
                    <td>
                      {d.wins}–{d.losses}
                    </td>
                    <td>{formatRate(d.wins, d.losses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="year-recap-block" aria-label="Best win rates">
        <h3 className="year-recap-sub">Best win rates</h3>
        {recap.bestRates.length === 0 && recap.playerRates.length === 0 ? (
          <p className="year-recap-note">
            A win rate shows once a deck or player has {DECK_RATE_MIN_GAMES} games with a winner.
          </p>
        ) : (
          <ul className="year-recap-list">
            {recap.bestRates.map((d) => (
              <li key={d.deckId}>
                <span className="year-recap-list-name">{d.deckName}</span>
                <span className="year-recap-list-value">
                  {formatRate(d.wins, d.losses)} over {d.wins + d.losses}
                </span>
              </li>
            ))}
            {recap.playerRates.map((p) => (
              <li key={`p:${p.name}`}>
                <span className="year-recap-list-name">{p.name}</span>
                <span className="year-recap-list-value">
                  {formatRate(p.wins, p.losses)} over {p.wins + p.losses}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recap.longest.length > 0 && (
        <section className="year-recap-block" aria-label="Longest games">
          <h3 className="year-recap-sub">Longest games</h3>
          <ul className="year-recap-list">
            {recap.longest.map((g) => (
              <li key={g.id}>
                <span className="year-recap-list-name">
                  {new Date(g.endedAt).toLocaleDateString()} ·{' '}
                  {gameFormatLabel(g.format) ?? g.format}
                  {g.winnerName ? ` · ${g.winnerName} won` : ''}
                </span>
                <span className="year-recap-list-value">{span(g.durationMs)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {capNote && <p className="year-recap-note">{capNote}</p>}
    </Surface>
  );
}
