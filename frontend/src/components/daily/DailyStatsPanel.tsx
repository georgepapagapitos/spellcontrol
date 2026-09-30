import { MeterBar } from '@/components/shared/MeterBar';
import { Surface } from '@/components/shared/Surface';
import type { DailyStats } from '@/lib/daily/stats';

/**
 * Your record: four numbers, then how many guesses your solves took. The row
 * for today's solve is marked in words as well as colour.
 */
export function DailyStatsPanel({
  stats,
  todayGuesses,
}: {
  stats: DailyStats;
  todayGuesses: number | null;
}) {
  const peak = Math.max(1, ...stats.distribution);
  return (
    <Surface
      variant="framed"
      as="section"
      className="daily-panel"
      aria-labelledby="daily-stats-title"
    >
      <h2 id="daily-stats-title" className="daily-panel-title">
        Your results
      </h2>
      <dl className="daily-stats">
        <div>
          <dt>Played</dt>
          <dd>{stats.played}</dd>
        </div>
        <div>
          <dt>Solved</dt>
          <dd>{stats.solvedPct}%</dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd>{stats.streak}</dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd>{stats.best}</dd>
        </div>
      </dl>
      <h3 className="daily-dist-title">Guesses to solve</h3>
      <ol className="daily-dist">
        {stats.distribution.map((count, i) => {
          const today = todayGuesses === i + 1;
          return (
            <li key={i} className={`daily-dist-row${today ? ' is-today' : ''}`}>
              <span className="daily-dist-n">{i + 1}</span>
              <MeterBar
                value={count}
                max={peak}
                minPct={count > 0 ? 4 : 0}
                color={today ? 'var(--accent)' : 'var(--text-muted)'}
              />
              <span className="daily-dist-count">
                {count}
                {today && <span className="daily-dist-today"> today</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </Surface>
  );
}
