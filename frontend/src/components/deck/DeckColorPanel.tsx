import { type JSX, useState } from 'react';
import { COLOR_INFO } from '../../lib/colors';
import { DeckColorBalance } from './DeckColorBalance';
import { useCardCarousel, tallyToEntries, type CardTally } from './useCardCarousel';
import { CardGroupSheet } from './CardGroupSheet';
import './DeckColorPanel.css';

/**
 * The deck's "color story" in two compact readouts:
 *   (a) Distribution — an SVG donut of colored-card counts per WUBRG+C.
 *   (b) Mana base     — <DeckColorBalance>: colored-mana demand vs. the sources
 *                       producing each color (+ a colorless row). This folds in
 *                       what used to be a separate "Production" list — the
 *                       Sources side of each row is the same per-color source
 *                       count, now tappable to that color's sources.
 *
 * Distribution legend entries and Mana base rows are tappable → a carousel of
 * the cards behind that color, when the per-color card lists are supplied.
 */

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'];

function DistributionDonut({
  counts,
  total,
  onShowColor,
  cardsByColor,
}: {
  counts: Record<string, number>;
  total: number;
  onShowColor?: (k: string) => void;
  cardsByColor?: Record<string, CardTally[]>;
}) {
  if (total === 0) return <div className="deck-color-empty">No data</div>;

  const radius = 36;
  const stroke = 14;
  const circ = 2 * Math.PI * radius;

  // Precompute each colored segment's arc length + cumulative start offset so
  // the JSX map is pure (no reassigning a running total mid-render — the React
  // Compiler flags that). reduce threads the running offset functionally.
  const segments = COLOR_ORDER.filter((k) => (counts[k] ?? 0) > 0).reduce<
    Array<{ k: string; len: number; offset: number }>
  >((acc, k) => {
    const len = ((counts[k] ?? 0) / total) * circ;
    const offset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].len : 0;
    acc.push({ k, len, offset });
    return acc;
  }, []);

  return (
    <div className="deck-color-donut">
      <svg viewBox="-50 -50 100 100" width={112} height={112} aria-label="Color distribution">
        <circle r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {segments.map(({ k, len, offset }) => (
          <circle
            key={k}
            r={radius}
            fill="none"
            stroke={COLOR_INFO[k]?.pip ?? 'var(--accent)'}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${circ - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90)"
          />
        ))}
      </svg>
      <ul className="deck-color-donut-legend">
        {COLOR_ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => {
          const v = counts[k];
          const pct = Math.round((v / total) * 100);
          const label = COLOR_INFO[k]?.label ?? k;
          const interactive = !!onShowColor && (cardsByColor?.[k]?.length ?? 0) > 0;
          const inner = (
            <>
              <span
                className="deck-color-donut-swatch"
                style={{ background: COLOR_INFO[k]?.pip }}
              />
              <span className="deck-color-donut-name">{label}</span>
              <span className="deck-color-donut-pct">{pct}%</span>
              {interactive && (
                <span className="deck-color-donut-chevron" aria-hidden="true">
                  ›
                </span>
              )}
            </>
          );
          return (
            <li key={k}>
              {interactive ? (
                <button
                  type="button"
                  className="deck-color-donut-legend-row"
                  onClick={() => onShowColor(k)}
                  aria-label={`Show the ${v} ${label} cards`}
                >
                  {inner}
                </button>
              ) : (
                <div className="deck-color-donut-legend-row">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DeckColorPanel({
  colorDist,
  manaProduction,
  cardsByColor,
  manaCurve,
}: {
  colorDist: { counts: Record<string, number>; total: number };
  manaProduction: {
    counts: Record<string, number>;
    total: number;
    sourcesByColor?: Record<string, CardTally[]>;
  };
  /** Per-color card lists for the Distribution donut drill-down (non-land cards
   *  by color identity). */
  cardsByColor?: Record<string, CardTally[]>;
  /** Nonland mana curve (CMC → count) → pacing for the Mana base shortfall bar. */
  manaCurve?: Record<number, number>;
}): JSX.Element {
  // Two carousels so each drill-down shows an accurate context label: the
  // Production sources vs. the Distribution (colored cards) for a color.
  const sourcesCarousel = useCardCarousel('Mana sources');
  const colorsCarousel = useCardCarousel('Color');

  // Tapping a color opens the grouped overview sheet (grid/list) first, then a
  // tapped card hands off to that drill-down's carousel for the detail read.
  const [groupSheet, setGroupSheet] = useState<{
    title: string;
    tally: CardTally[];
    carousel: ReturnType<typeof useCardCarousel>;
  } | null>(null);

  const openGroup = (
    carousel: ReturnType<typeof useCardCarousel>,
    tally: CardTally[] | undefined,
    title: string
  ) => {
    if (!tally || tally.length === 0) return;
    const sorted = [...tally].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    setGroupSheet({ title, tally: sorted, carousel });
  };

  const pickFromGroup = (picked: CardTally) => {
    if (!groupSheet) return;
    void groupSheet.carousel.open(tallyToEntries(groupSheet.tally), picked.name);
  };

  const colorLabel = (k: string) => COLOR_INFO[k]?.label ?? k;

  return (
    <div className="deck-color-panel">
      <section className="deck-color-section" aria-label="Color distribution section">
        <h5 className="deck-color-subheading">Distribution</h5>
        <DistributionDonut
          counts={colorDist.counts}
          total={colorDist.total}
          cardsByColor={cardsByColor}
          onShowColor={(k) => openGroup(colorsCarousel, cardsByColor?.[k], colorLabel(k))}
        />
      </section>

      <DeckColorBalance
        colorRequirements={colorDist.counts}
        colorProduction={manaProduction.counts}
        sourcesByColor={manaProduction.sourcesByColor}
        onShowSources={(k) =>
          openGroup(sourcesCarousel, manaProduction.sourcesByColor?.[k], `${colorLabel(k)} sources`)
        }
        manaCurve={manaCurve}
      />

      {groupSheet && (
        <CardGroupSheet
          title={groupSheet.title}
          tally={groupSheet.tally}
          onPick={pickFromGroup}
          onClose={() => setGroupSheet(null)}
        />
      )}
      {sourcesCarousel.preview}
      {colorsCarousel.preview}
    </div>
  );
}
