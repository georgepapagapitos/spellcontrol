import { useMemo } from 'react';
import './DeckTypeBreakdown.css';

/**
 * Renders a deck's card-type composition as a sorted list, each row showing the
 * type name, its count, a proportional bar, and its percentage of the total.
 * Rows are ordered by count descending.
 *
 * `typeCounts` is e.g. { Creature: 30, Instant: 8, Land: 37 }.
 */
export function DeckTypeBreakdown({
  typeCounts,
}: {
  typeCounts: Record<string, number>;
}): JSX.Element {
  const { rows, total } = useMemo(() => {
    const entries = Object.entries(typeCounts).filter(([, count]) => count > 0);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    // Order by count desc, then alphabetically for stable ties.
    const rows = entries
      .map(([type, count]) => ({
        type,
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    return { rows, total };
  }, [typeCounts]);

  return (
    <section className="deck-type-breakdown" aria-label="Card type breakdown">
      <div className="deck-type-breakdown-head">
        <h4 className="deck-type-breakdown-heading">Card types</h4>
        <span className="deck-type-breakdown-total">{total} cards</span>
      </div>

      {rows.length === 0 ? (
        <p className="deck-type-breakdown-empty">No cards to break down.</p>
      ) : (
        <ul className="deck-type-breakdown-rows">
          {rows.map((row) => (
            <li key={row.type} className="deck-type-breakdown-row">
              <div className="deck-type-breakdown-row-head">
                <span className="deck-type-breakdown-row-name">{row.type}</span>
                <span className="deck-type-breakdown-row-meta">
                  <span className="deck-type-breakdown-row-count">{row.count}</span>
                  <span className="deck-type-breakdown-row-pct">{row.pct.toFixed(1)}%</span>
                </span>
              </div>
              <div className="deck-type-breakdown-row-track">
                <div className="deck-type-breakdown-row-fill" style={{ width: `${row.pct}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
