import { COLOR_INFO } from '../../lib/colors';
import { DeckColorBalance } from './DeckColorBalance';
import './DeckColorPanel.css';

/**
 * One cohesive "color story" panel that merges what used to be three separate
 * stat boxes:
 *   (a) Distribution — an SVG donut of colored-card counts per WUBRG+C.
 *   (b) Production    — horizontal bars of land production sources per color.
 *   (c) Balance       — the existing <DeckColorBalance>, comparing colored-mana
 *                       demand against the sources that produce each color.
 *
 * Each section gets a small muted sub-heading so the three readouts read as one
 * panel rather than three disconnected widgets.
 */

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'];

function DistributionDonut({ counts, total }: { counts: Record<string, number>; total: number }) {
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
      <svg viewBox="-50 -50 100 100" width={88} height={88} aria-label="Color distribution">
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
          return (
            <li key={k}>
              <span
                className="deck-color-donut-swatch"
                style={{ background: COLOR_INFO[k]?.pip }}
              />
              <span>{COLOR_INFO[k]?.label ?? k}</span>
              <span className="deck-color-donut-pct">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProductionBars({ counts, total }: { counts: Record<string, number>; total: number }) {
  const max = Math.max(1, ...COLOR_ORDER.map((k) => counts[k] ?? 0));
  if (total === 0) return <div className="deck-color-empty">No lands</div>;
  return (
    <ul className="deck-color-prod">
      {COLOR_ORDER.filter((k) => (counts[k] ?? 0) > 0)
        .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
        .map((k) => {
          const v = counts[k];
          const pct = Math.round((v / total) * 100);
          return (
            <li key={k}>
              <div className="deck-color-prod-row">
                <span
                  className="deck-color-prod-swatch"
                  style={{ background: COLOR_INFO[k]?.pip }}
                />
                <span className="deck-color-prod-name">{COLOR_INFO[k]?.label ?? k}</span>
                <span className="deck-color-prod-meta">
                  {v} {v === 1 ? 'source' : 'sources'} · {pct}%
                </span>
              </div>
              <div className="deck-color-prod-bar">
                <div
                  className="deck-color-prod-bar-fill"
                  style={{
                    width: `${(v / max) * 100}%`,
                    background: COLOR_INFO[k]?.pip,
                  }}
                />
              </div>
            </li>
          );
        })}
    </ul>
  );
}

export function DeckColorPanel({
  colorDist,
  manaProduction,
}: {
  colorDist: { counts: Record<string, number>; total: number };
  manaProduction: { counts: Record<string, number>; total: number };
}): JSX.Element {
  return (
    <div className="deck-color-panel">
      <section className="deck-color-section" aria-label="Color distribution section">
        <h5 className="deck-color-subheading">Distribution</h5>
        <DistributionDonut counts={colorDist.counts} total={colorDist.total} />
      </section>

      <section className="deck-color-section" aria-label="Mana production">
        <h5 className="deck-color-subheading">Production</h5>
        <ProductionBars counts={manaProduction.counts} total={manaProduction.total} />
      </section>

      <section className="deck-color-section" aria-label="Color balance section">
        <h5 className="deck-color-subheading">Balance</h5>
        <DeckColorBalance
          colorRequirements={colorDist.counts}
          colorProduction={manaProduction.counts}
        />
      </section>
    </div>
  );
}
