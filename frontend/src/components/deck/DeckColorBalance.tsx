import { useMemo } from 'react';
import type { CardTally } from './useCardCarousel';
import './DeckColorBalance.css';

/**
 * The deck's "mana base" readout: for each WUBRG color, colored-mana demand
 * (pips across nonland cards) against the sources that produce it (lands / rocks
 * / dorks), with a shortfall flag when sources look thin. A trailing colorless
 * row surfaces ramp like Sol Ring. Rows whose sources are known are tappable →
 * a carousel of those sources (this folds in what used to be a separate
 * "Production" list).
 *
 * `colorRequirements` / `colorProduction` are keyed by WUBRG(+C) codes;
 * `sourcesByColor` carries the per-color source cards for the drill-down.
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
// Below this many colored pips, a single source easily covers the demand, so we don't
// flag the color as short (small-splash forgiveness). Zero-source colors flag regardless.
const MIN_FLAG_DEMAND = 3;

export function DeckColorBalance({
  colorRequirements,
  colorProduction,
  sourcesByColor,
  onShowSources,
}: {
  colorRequirements: Record<string, number>;
  colorProduction: Record<string, number>;
  sourcesByColor?: Record<string, CardTally[]>;
  onShowSources?: (color: string) => void;
}): JSX.Element {
  const { rows, scaleMax, colorlessProd } = useMemo(() => {
    const rows = WUBRG.map((color) => {
      const demand = colorRequirements[color] ?? 0;
      const production = colorProduction[color] ?? 0;
      const hasDemand = demand > 0;
      // Flag a color as "short" when:
      //  - it has demand but zero sources (you literally can't produce it) — always flag, or
      //  - production falls below the shortfall ratio AND demand is non-trivial.
      // The MIN_FLAG_DEMAND guard forgives tiny splashes: a color with only 1-2 pips
      // is comfortably covered by a single source, so we don't nag about it.
      const short =
        hasDemand &&
        production < demand * SHORTFALL_RATIO &&
        (production === 0 || demand >= MIN_FLAG_DEMAND);
      return { color, name: COLOR_NAME[color], demand, production, hasDemand, short };
    }).filter((row) => row.demand > 0 || row.production > 0);

    const colorlessProd = colorProduction.C ?? 0;
    // Shared scale so demand/sources bars are comparable across rows — include
    // the colorless source count so its bar reads on the same axis.
    const scaleMax = rows.reduce((m, r) => Math.max(m, r.demand, r.production), colorlessProd);
    return { rows, scaleMax, colorlessProd };
  }, [colorRequirements, colorProduction]);

  // A row is tappable when we have its source list to open.
  const sourceCount = (color: string) => sourcesByColor?.[color]?.length ?? 0;
  const tappable = (color: string) => !!onShowSources && sourceCount(color) > 0;
  const pct = (n: number) => (scaleMax > 0 ? (n / scaleMax) * 100 : 0);

  return (
    <section className="deck-color-balance" aria-label="Mana base">
      <h4 className="deck-color-balance-heading">Mana base</h4>

      {rows.length === 0 && colorlessProd === 0 ? (
        <p className="deck-color-balance-empty">No colored mana to balance.</p>
      ) : (
        <ul className="deck-color-balance-rows">
          {rows.map((row) => {
            const isTap = tappable(row.color);
            const inner = (
              <>
                <div className="deck-color-balance-row-head">
                  <span className="deck-color-balance-row-name">
                    <span
                      className={`deck-color-balance-pip deck-color-balance-pip-${row.color.toLowerCase()}`}
                      aria-hidden="true"
                    />
                    {row.name}
                  </span>
                  <span className="deck-color-balance-row-tags">
                    {row.short && <span className="deck-color-balance-flag">Sources short</span>}
                    {isTap && (
                      <span className="deck-color-balance-chevron" aria-hidden="true">
                        ›
                      </span>
                    )}
                  </span>
                </div>

                <div className="deck-color-balance-meter">
                  <span className="deck-color-balance-meter-label">Demand</span>
                  <div className="deck-color-balance-track">
                    <div
                      className="deck-color-balance-fill deck-color-balance-fill-demand"
                      style={{ width: `${pct(row.demand)}%` }}
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
                      style={{ width: `${pct(row.production)}%` }}
                    />
                  </div>
                  <span className="deck-color-balance-meter-value">{row.production}</span>
                </div>
              </>
            );
            return (
              <li
                key={row.color}
                className={`deck-color-balance-row${
                  row.hasDemand ? '' : ' deck-color-balance-row-neutral'
                }`}
              >
                {isTap ? (
                  <button
                    type="button"
                    className="deck-color-balance-row-btn"
                    onClick={() => onShowSources?.(row.color)}
                    aria-label={`Show the ${sourceCount(row.color)} ${row.name} mana sources`}
                  >
                    {inner}
                  </button>
                ) : (
                  inner
                )}
              </li>
            );
          })}

          {colorlessProd > 0 && (
            <li className="deck-color-balance-row">
              {(() => {
                const isTap = tappable('C');
                const inner = (
                  <>
                    <div className="deck-color-balance-row-head">
                      <span className="deck-color-balance-row-name">
                        <span
                          className="deck-color-balance-pip deck-color-balance-pip-c"
                          aria-hidden="true"
                        />
                        Colorless
                      </span>
                      {isTap && (
                        <span className="deck-color-balance-chevron" aria-hidden="true">
                          ›
                        </span>
                      )}
                    </div>
                    <div className="deck-color-balance-meter">
                      <span className="deck-color-balance-meter-label">Sources</span>
                      <div className="deck-color-balance-track">
                        <div
                          className="deck-color-balance-fill deck-color-balance-fill-sources"
                          style={{ width: `${pct(colorlessProd)}%` }}
                        />
                      </div>
                      <span className="deck-color-balance-meter-value">{colorlessProd}</span>
                    </div>
                  </>
                );
                return isTap ? (
                  <button
                    type="button"
                    className="deck-color-balance-row-btn"
                    onClick={() => onShowSources?.('C')}
                    aria-label={`Show the ${sourceCount('C')} colorless mana sources`}
                  >
                    {inner}
                  </button>
                ) : (
                  inner
                );
              })()}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
