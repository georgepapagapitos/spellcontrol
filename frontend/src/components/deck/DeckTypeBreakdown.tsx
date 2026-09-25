import { type JSX, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { classifyType } from '@/lib/build-mana-data';
import { useCardCarousel, tallyToEntries, type CardTally } from './useCardCarousel';
import { CardGroupSheet } from './CardGroupSheet';
import { MeterBar } from '../shared/MeterBar';
import './DeckTypeBreakdown.css';

const COMMANDER_ROW = 'Commander';

/**
 * Renders a deck's card-type composition as a list, each row showing the type
 * name, its count and a proportional bar. The command zone leads as its own
 * "Commander" row, the way the deck list files it, and the types follow by
 * count descending, so a Creature count here is the list's Creature section.
 *
 * `typeCounts` is e.g. { Creature: 30, Instant: 8, Land: 37 }, commander
 * included (as buildManaData counts it). When `cardsByType` is supplied, each
 * row becomes tappable → a sheet of that type's cards.
 */
export function DeckTypeBreakdown({
  typeCounts,
  cardsByType,
  commandZone = [],
}: {
  typeCounts: Record<string, number>;
  cardsByType?: Record<string, CardTally[]>;
  /** The commander (and partner). Counted in `typeCounts` under their card
   *  type; shown instead as a Commander row, as the deck list does. */
  commandZone?: ScryfallCard[];
}): JSX.Element {
  const carousel = useCardCarousel('Card types');
  // Tapping a type row opens the grouped overview sheet (same drill-down as the
  // curve) before the one-at-a-time carousel.
  const [groupSheet, setGroupSheet] = useState<{ title: string; tally: CardTally[] } | null>(null);

  const { rows, total, tallies } = useMemo(() => {
    // Take the command zone out of its card type, card for card.
    const counts: Record<string, number> = { ...typeCounts };
    const tallies: Record<string, CardTally[]> = { ...(cardsByType ?? {}) };
    for (const card of commandZone) {
      const type = classifyType(card);
      if ((counts[type] ?? 0) > 0) counts[type] -= 1;
      const list = tallies[type];
      if (list) {
        tallies[type] = list
          .map((t) => (t.name === card.name ? { ...t, count: t.count - 1 } : t))
          .filter((t) => t.count > 0);
      }
    }
    if (commandZone.length > 0) {
      tallies[COMMANDER_ROW] = commandZone.map((card) => ({ name: card.name, count: 1, card }));
    }
    const entries = Object.entries(counts).filter(([, count]) => count > 0);
    const total = entries.reduce((sum, [, count]) => sum + count, 0) + commandZone.length;
    // Order by count desc, then alphabetically for stable ties.
    const typeRows = entries
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    const rows =
      commandZone.length > 0
        ? [{ type: COMMANDER_ROW, count: commandZone.length }, ...typeRows]
        : typeRows;
    return { rows, total, tallies };
  }, [typeCounts, cardsByType, commandZone]);

  const showType = (type: string) => {
    const tally = tallies[type] ?? [];
    if (tally.length === 0) return;
    const sorted = [...tally].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    setGroupSheet({ title: type, tally: sorted });
  };

  const pickFromGroup = (picked: CardTally) => {
    if (!groupSheet) return;
    void carousel.open(tallyToEntries(groupSheet.tally), picked.name);
  };

  return (
    <section className="deck-type-breakdown" aria-label="Card type breakdown">
      {/* No inner heading: the host panel's "Types" eyebrow already names this. */}
      <div className="deck-type-breakdown-head">
        <span className="deck-type-breakdown-total">{total} cards</span>
      </div>

      {rows.length === 0 ? (
        <p className="deck-type-breakdown-empty">No cards to break down.</p>
      ) : (
        <ul className="deck-type-breakdown-rows">
          {rows.map((row) => {
            const interactive = (tallies[row.type]?.length ?? 0) > 0;
            const body = (
              <>
                <div className="deck-type-breakdown-row-head">
                  <span className="deck-type-breakdown-row-name">{row.type}</span>
                  <span className="deck-type-breakdown-row-meta">
                    <span className="deck-type-breakdown-row-count">{row.count}</span>
                    {interactive && (
                      <span className="deck-type-breakdown-row-chevron" aria-hidden="true">
                        ›
                      </span>
                    )}
                  </span>
                </div>
                <MeterBar value={row.count} max={total} />
              </>
            );
            return (
              <li key={row.type} className="deck-type-breakdown-row">
                {interactive ? (
                  <button
                    type="button"
                    className="deck-type-breakdown-row-btn"
                    onClick={() => showType(row.type)}
                    aria-label={
                      row.type === COMMANDER_ROW
                        ? 'Show the commander'
                        : `Show the ${row.count} ${row.type} cards`
                    }
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
