import { useMemo, useState } from 'react';
import { useCardCarousel, tallyToEntries, type CardTally } from './useCardCarousel';
import { CardGroupSheet } from './CardGroupSheet';
import './DeckTypeBreakdown.css';

/**
 * Renders a deck's card-type composition as a sorted list, each row showing the
 * type name, its count, a proportional bar, and its percentage of the total.
 * Rows are ordered by count descending.
 *
 * `typeCounts` is e.g. { Creature: 30, Instant: 8, Land: 37 }. When `cardsByType`
 * is supplied, each row becomes tappable → a carousel of that type's cards.
 */
export function DeckTypeBreakdown({
  typeCounts,
  cardsByType,
}: {
  typeCounts: Record<string, number>;
  cardsByType?: Record<string, CardTally[]>;
}): JSX.Element {
  const carousel = useCardCarousel('Card types');
  // Tapping a type row opens the grouped overview sheet (same drill-down as the
  // curve) before the one-at-a-time carousel.
  const [groupSheet, setGroupSheet] = useState<{ title: string; tally: CardTally[] } | null>(null);

  const showType = (type: string) => {
    const tally = cardsByType?.[type] ?? [];
    if (tally.length === 0) return;
    const sorted = [...tally].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    setGroupSheet({ title: type, tally: sorted });
  };

  const pickFromGroup = (picked: CardTally) => {
    if (!groupSheet) return;
    void carousel.open(tallyToEntries(groupSheet.tally), picked.name);
  };
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
          {rows.map((row) => {
            const interactive = (cardsByType?.[row.type]?.length ?? 0) > 0;
            const body = (
              <>
                <div className="deck-type-breakdown-row-head">
                  <span className="deck-type-breakdown-row-name">{row.type}</span>
                  <span className="deck-type-breakdown-row-meta">
                    <span className="deck-type-breakdown-row-count">{row.count}</span>
                    <span className="deck-type-breakdown-row-pct">{row.pct.toFixed(1)}%</span>
                    {interactive && (
                      <span className="deck-type-breakdown-row-chevron" aria-hidden="true">
                        ›
                      </span>
                    )}
                  </span>
                </div>
                <div className="deck-type-breakdown-row-track">
                  <div className="deck-type-breakdown-row-fill" style={{ width: `${row.pct}%` }} />
                </div>
              </>
            );
            return (
              <li key={row.type} className="deck-type-breakdown-row">
                {interactive ? (
                  <button
                    type="button"
                    className="deck-type-breakdown-row-btn"
                    onClick={() => showType(row.type)}
                    aria-label={`Show the ${row.count} ${row.type} cards`}
                  >
                    {body}
                  </button>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
      {groupSheet && (
        <CardGroupSheet
          title={groupSheet.title}
          tally={groupSheet.tally}
          onPick={pickFromGroup}
          onClose={() => setGroupSheet(null)}
        />
      )}
      {carousel.preview}
    </section>
  );
}
