import { type JSX, useMemo } from 'react';
import {
  isColorShort,
  shortfallThresholdsForCurve,
} from '@/deck-builder/services/deckBuilder/colorShortfall';
import type { CardTally } from './useCardCarousel';
import { MeterBar } from '../shared/MeterBar';
import './DeckColorBalance.css';

/**
 * The deck's mana base, one hairline row per color: how many non-land cards
 * need that color against how many sources make it (lands, rocks, dorks), on
 * one shared scale, with the color flagged in words when its sources look
 * thin. A trailing colorless row counts colorless cards and sources (Sol Ring).
 * Each number opens what it counts: the cards of that color, or its sources.
 *
 * `colorRequirements` counts non-land cards per color (WUBRG + C, a card
 * counted once per color it needs); `colorProduction` counts sources per
 * color; `cardsByColor` / `sourcesByColor` carry the lists behind them.
 */

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;
type Color = (typeof WUBRG)[number] | 'C';

const COLOR_NAME: Record<Color, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

/**
 * Shortfall heuristic (simple + transparent).
 *
 * A color is flagged "short" when it has real card demand but its sources cover
 * too little of it. The bar — a coverage ratio plus a splash-forgiveness
 * floor — is **pacing-aware**: it's derived from the deck's own mana curve so an
 * aggressive deck (which must hit its colors on curve) is judged stricter and a
 * late-game deck more forgiving. The thresholds + predicate live in the tested
 * `colorShortfall` helper; see it for the bands. Colors with zero demand are
 * never flagged and render in a neutral, dimmed style. Colorless is never
 * flagged: any source makes colorless mana.
 */
export function DeckColorBalance({
  colorRequirements,
  colorProduction,
  sourcesByColor,
  cardsByColor,
  onShowSources,
  onShowCards,
  manaCurve,
  landUpgradeCount = 0,
  onReanalyzeLands,
}: {
  colorRequirements: Record<string, number>;
  colorProduction: Record<string, number>;
  sourcesByColor?: Record<string, CardTally[]>;
  cardsByColor?: Record<string, CardTally[]>;
  onShowSources?: (color: string) => void;
  onShowCards?: (color: string) => void;
  /** The deck's nonland mana curve (CMC → count), used to derive pacing for the
   *  shortfall thresholds. Absent → balanced pacing → the static base bar. */
  manaCurve?: Record<number, number>;
  /** How many stronger owned lands the merit-based engine found for this deck.
   *  Drives the "Re-analyze lands" call-to-action — hidden at 0 (no nag). */
  landUpgradeCount?: number;
  /** Deep-link into the Coach tab's Lands lane to review the proposed swaps. */
  onReanalyzeLands?: () => void;
}): JSX.Element {
  const { rows, scaleMax } = useMemo(() => {
    const thresholds = shortfallThresholdsForCurve(manaCurve ?? {});
    const colored = WUBRG.map((color) => {
      const demand = colorRequirements[color] ?? 0;
      const production = colorProduction[color] ?? 0;
      return {
        color: color as Color,
        demand,
        production,
        short: isColorShort(demand, production, thresholds),
      };
    });
    const colorless = {
      color: 'C' as Color,
      demand: colorRequirements.C ?? 0,
      production: colorProduction.C ?? 0,
      short: false,
    };
    const rows = [...colored, colorless].filter((r) => r.demand > 0 || r.production > 0);
    // One shared scale so cards and sources compare across every row.
    const scaleMax = rows.reduce((m, r) => Math.max(m, r.demand, r.production), 0);
    return { rows, scaleMax };
  }, [colorRequirements, colorProduction, manaCurve]);

  const listed = (lists: Record<string, CardTally[]> | undefined, color: string) =>
    lists?.[color]?.length ?? 0;

  return (
    <section className="deck-color-balance" aria-label="Mana base">
      {rows.length === 0 ? (
        <p className="deck-color-balance-empty">No colored mana to balance.</p>
      ) : (
        <ul className="deck-color-balance-rows">
          {rows.map((row) => {
            const name = COLOR_NAME[row.color];
            const lower = name.toLowerCase();
            const canShowCards = !!onShowCards && listed(cardsByColor, row.color) > 0;
            const canShowSources = !!onShowSources && listed(sourcesByColor, row.color) > 0;
            return (
              <li
                key={row.color}
                className={`deck-color-balance-row${
                  row.demand > 0 || row.color === 'C' ? '' : ' deck-color-balance-row-neutral'
                }${row.short ? ' is-short' : ''}`}
              >
                <span className="deck-color-balance-row-name">
                  <span
                    className={`deck-color-balance-pip deck-color-balance-pip-${row.color.toLowerCase()}`}
                    aria-hidden="true"
                  />
                  {name}
                  {row.short && (
                    <span className="deck-color-balance-flag">
                      <span aria-hidden="true">▾ </span>short
                    </span>
                  )}
                </span>
                <span className="deck-color-balance-bars" aria-hidden="true">
                  <MeterBar value={row.demand} max={scaleMax} color="var(--text-muted)" />
                  <MeterBar
                    value={row.production}
                    max={scaleMax}
                    color={row.short ? 'var(--warn-text)' : 'var(--accent)'}
                  />
                </span>
                <span className="deck-color-balance-values">
                  <CountLink
                    count={row.demand}
                    unit={row.demand === 1 ? 'card' : 'cards'}
                    label={`Show the ${row.demand} ${lower} cards`}
                    onClick={canShowCards ? () => onShowCards?.(row.color) : undefined}
                  />
                  <CountLink
                    count={row.production}
                    unit={row.production === 1 ? 'source' : 'sources'}
                    label={`Show the ${row.production} ${lower} mana sources`}
                    onClick={canShowSources ? () => onShowSources?.(row.color) : undefined}
                    tone={row.short ? 'warn' : undefined}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <ul className="deck-color-balance-legend" aria-label="Legend">
          <li>
            <span
              className="deck-color-balance-legend-swatch deck-color-balance-legend-cards"
              aria-hidden="true"
            />
            Cards that need the color
          </li>
          <li>
            <span
              className="deck-color-balance-legend-swatch deck-color-balance-legend-sources"
              aria-hidden="true"
            />
            Sources that make it
          </li>
        </ul>
      )}

      {landUpgradeCount > 0 && onReanalyzeLands && (
        <button type="button" className="deck-color-balance-reanalyze" onClick={onReanalyzeLands}>
          <span className="deck-color-balance-reanalyze-text">
            {landUpgradeCount === 1
              ? '1 stronger land for this deck'
              : `${landUpgradeCount} stronger lands for this deck`}
          </span>
          <span className="deck-color-balance-reanalyze-chevron" aria-hidden="true">
            ›
          </span>
        </button>
      )}
    </section>
  );
}

/** "38 cards": a link to the list it counts when there is one, plain text otherwise. */
function CountLink({
  count,
  unit,
  label,
  onClick,
  tone,
}: {
  count: number;
  unit: string;
  label: string;
  onClick?: () => void;
  tone?: 'warn';
}): JSX.Element {
  const body = (
    <>
      <span className="deck-color-balance-count">{count}</span> {unit}
    </>
  );
  const cls = `deck-color-balance-value${tone ? ` is-${tone}` : ''}`;
  return onClick ? (
    <button
      type="button"
      className={`${cls} deck-color-balance-value-btn`}
      onClick={onClick}
      aria-label={label}
    >
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}
