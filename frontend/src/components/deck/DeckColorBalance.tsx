import { type JSX, useMemo } from 'react';
import {
  isColorShort,
  shortfallThresholdsForCurve,
} from '@/deck-builder/services/deckBuilder/colorShortfall';
import type { CardTally } from './useCardCarousel';
import { MeterBar } from '../shared/MeterBar';
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
 * too little of that demand. The bar — a coverage ratio plus a splash-forgiveness
 * floor — is **pacing-aware**: it's derived from the deck's own mana curve so an
 * aggressive deck (which must hit its colors on curve) is judged stricter and a
 * late-game deck more forgiving. The thresholds + predicate live in the tested
 * `colorShortfall` helper; see it for the bands. Colors with zero demand are
 * never flagged and render in a neutral, dimmed style.
 */
export function DeckColorBalance({
  colorRequirements,
  colorProduction,
  sourcesByColor,
  onShowSources,
  manaCurve,
}: {
  colorRequirements: Record<string, number>;
  colorProduction: Record<string, number>;
  sourcesByColor?: Record<string, CardTally[]>;
  onShowSources?: (color: string) => void;
  /** The deck's nonland mana curve (CMC → count), used to derive pacing for the
   *  shortfall thresholds. Absent → balanced pacing → the static base bar. */
  manaCurve?: Record<number, number>;
}): JSX.Element {
  const { rows, scaleMax, colorlessProd } = useMemo(() => {
    const thresholds = shortfallThresholdsForCurve(manaCurve ?? {});
    const rows = WUBRG.map((color) => {
      const demand = colorRequirements[color] ?? 0;
      const production = colorProduction[color] ?? 0;
      const hasDemand = demand > 0;
      const short = isColorShort(demand, production, thresholds);
      return { color, name: COLOR_NAME[color], demand, production, hasDemand, short };
    }).filter((row) => row.demand > 0 || row.production > 0);

    const colorlessProd = colorProduction.C ?? 0;
    // Shared scale so demand/sources bars are comparable across rows — include
    // the colorless source count so its bar reads on the same axis.
    const scaleMax = rows.reduce((m, r) => Math.max(m, r.demand, r.production), colorlessProd);
    return { rows, scaleMax, colorlessProd };
  }, [colorRequirements, colorProduction, manaCurve]);

  // A row is tappable when we have its source list to open.
  const sourceCount = (color: string) => sourcesByColor?.[color]?.length ?? 0;
  const tappable = (color: string) => !!onShowSources && sourceCount(color) > 0;

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
                  <MeterBar value={row.demand} max={scaleMax} color="var(--text-muted)" />
                  <span className="deck-color-balance-meter-value">{row.demand}</span>
                </div>

                <div className="deck-color-balance-meter">
                  <span className="deck-color-balance-meter-label">Sources</span>
                  <MeterBar
                    value={row.production}
                    max={scaleMax}
                    color={row.short ? 'var(--warn-text)' : 'var(--accent)'}
                  />
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
                      <MeterBar value={colorlessProd} max={scaleMax} color="var(--accent)" />
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
