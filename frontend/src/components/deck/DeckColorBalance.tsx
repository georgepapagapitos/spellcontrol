import { useMemo } from 'react';
import './DeckColorBalance.css';

/**
 * Compares colored-mana demand (pips across nonland cards) against the sources
 * that produce each color (lands / rocks / dorks). Each WUBRG color gets a row
 * with a demand bar and a production bar, and a shortfall flag when sources
 * look thin relative to demand.
 *
 * `colorRequirements` and `colorProduction` are keyed by the single-letter
 * WUBRG codes.
 */

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;
type Color = (typeof WUBRG)[number];

const COLOR_NAME: Record<Color, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

/**
 * Shortfall heuristic (simple + transparent).
 *
 * A color is flagged "short" when it has real pip demand but its sources cover
 * less than 60% of that demand. The 0.6 ratio is a rough rule of thumb: you
 * generally want at least as many sources as pips for a color you lean on, and
 * dropping much below that makes the color unreliable to cast on curve. Colors
 * with zero demand are never flagged and render in a neutral, dimmed style.
 */
const SHORTFALL_RATIO = 0.6;

export function DeckColorBalance({
  colorRequirements,
  colorProduction,
}: {
  colorRequirements: Record<string, number>;
  colorProduction: Record<string, number>;
}): JSX.Element {
  const { rows, scaleMax } = useMemo(() => {
    const rows = WUBRG.map((color) => {
      const demand = colorRequirements[color] ?? 0;
      const production = colorProduction[color] ?? 0;
      const hasDemand = demand > 0;
      const short = hasDemand && production < demand * SHORTFALL_RATIO;
      return { color, name: COLOR_NAME[color], demand, production, hasDemand, short };
    }).filter((row) => row.demand > 0 || row.production > 0);

    // Shared scale so demand/production bars are comparable across rows.
    const scaleMax = rows.reduce((m, r) => Math.max(m, r.demand, r.production), 0);
    return { rows, scaleMax };
  }, [colorRequirements, colorProduction]);

  return (
    <section className="deck-color-balance" aria-label="Color balance">
      <h4 className="deck-color-balance-heading">Color balance</h4>

      {rows.length === 0 ? (
        <p className="deck-color-balance-empty">No colored mana to balance.</p>
      ) : (
        <ul className="deck-color-balance-rows">
          {rows.map((row) => {
            const demandPct = scaleMax > 0 ? (row.demand / scaleMax) * 100 : 0;
            const productionPct = scaleMax > 0 ? (row.production / scaleMax) * 100 : 0;
            return (
              <li
                key={row.color}
                className={`deck-color-balance-row${
                  row.hasDemand ? '' : ' deck-color-balance-row-neutral'
                }`}
              >
                <div className="deck-color-balance-row-head">
                  <span className="deck-color-balance-row-name">
                    <span
                      className={`deck-color-balance-pip deck-color-balance-pip-${row.color.toLowerCase()}`}
                      aria-hidden="true"
                    />
                    {row.name}
                  </span>
                  {row.short && <span className="deck-color-balance-flag">Sources short</span>}
                </div>

                <div className="deck-color-balance-meter">
                  <span className="deck-color-balance-meter-label">Demand</span>
                  <div className="deck-color-balance-track">
                    <div
                      className="deck-color-balance-fill deck-color-balance-fill-demand"
                      style={{ width: `${demandPct}%` }}
                    />
                  </div>
                  <span className="deck-color-balance-meter-value">{row.demand}</span>
                </div>

                <div className="deck-color-balance-meter">
                  <span className="deck-color-balance-meter-label">Sources</span>
                  <div className="deck-color-balance-track">
                    <div
                      className={`deck-color-balance-fill deck-color-balance-fill-sources${
                        row.short ? ' deck-color-balance-fill-short' : ''
                      }`}
                      style={{ width: `${productionPct}%` }}
                    />
                  </div>
                  <span className="deck-color-balance-meter-value">{row.production}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
