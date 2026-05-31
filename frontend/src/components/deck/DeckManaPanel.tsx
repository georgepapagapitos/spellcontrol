import { DeckCurvePhases } from './DeckCurvePhases';
import { DeckColorPanel } from './DeckColorPanel';
import { DeckTypeBreakdown } from './DeckTypeBreakdown';
import type { CardTally } from './useCardCarousel';
import './DeckManaPanel.css';

/** Per-CMC color split for the stacked "by color" curve. 0 colors → colorless,
 *  exactly 1 → that color, 2+ → gold (multicolor). */
export interface CurveColorBucket {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  gold: number;
  colorless: number;
}

export interface DeckManaData {
  manaCurve: Record<number, number>;
  /** Per-CMC color breakdown powering the stacked curve (omit → count-only). */
  curveByColor?: Record<number, CurveColorBucket>;
  averageCmc: number;
  colorDist: { counts: Record<string, number>; total: number };
  manaProduction: {
    counts: Record<string, number>;
    total: number;
    /** Per-color mana sources, deduped by name with copy counts — powers the
     *  "show me the N sources of White" drill-down in DeckColorPanel. */
    sourcesByColor?: Record<string, CardTally[]>;
  };
  typeBreakdown: Record<string, number>;
  /** Per-bucket card lists for the tap-to-preview drill-downs. Each maps a
   *  bucket (CMC / type / color) to its deduped cards. */
  cardsByCmc?: Record<number, CardTally[]>;
  cardsByType?: Record<string, CardTally[]>;
  cardsByColor?: Record<string, CardTally[]>;
}

/**
 * The deck's full "mana story" in a three-tier editorial layout:
 *
 *   Tier 1 — Hero:   the stacked color mana curve, full-width and elevated.
 *   Tier 2 — Pair:   Color (donut + mana base). Sits in a 2-col grid from
 *                    640px; DeckColorPanel spans both tracks so there's no
 *                    orphaned empty cell.
 *   Tier 3 — Footer: the type breakdown as a full-width wrapping strip.
 *
 * The form genuinely changes across breakpoints (stack on phones → 2-up pair
 * on tablet/desktop), not just column counts. Pure render; all computation
 * happens upstream in DeckDisplay. See DeckManaPanel.css.
 */
export function DeckManaPanel({
  manaCurve,
  curveByColor,
  averageCmc,
  colorDist,
  manaProduction,
  typeBreakdown,
  cardsByCmc,
  cardsByType,
  cardsByColor,
}: DeckManaData): JSX.Element {
  return (
    <div className="deck-mana-panel">
      {/* Tier 1 — Hero: the stacked color mana curve. */}
      <section className="deck-stats-panel deck-mana-panel__hero">
        <h4 className="deck-stats-panel-title">Mana curve</h4>
        <DeckCurvePhases
          manaCurve={manaCurve}
          curveByColor={curveByColor}
          averageCmc={averageCmc}
          cardsByCmc={cardsByCmc}
        />
      </section>

      {/* Tier 2 — Pair: color identity + mana base. */}
      <div className="deck-mana-panel__pair">
        <section className="deck-stats-panel deck-mana-panel__cell">
          <h4 className="deck-stats-panel-title">Color</h4>
          <DeckColorPanel
            colorDist={colorDist}
            manaProduction={manaProduction}
            cardsByColor={cardsByColor}
          />
        </section>
      </div>

      {/* Tier 3 — Footer: type breakdown as a full-width strip. */}
      <section className="deck-stats-panel deck-mana-panel__footer">
        <h4 className="deck-stats-panel-title">Types</h4>
        <DeckTypeBreakdown typeCounts={typeBreakdown} cardsByType={cardsByType} />
      </section>
    </div>
  );
}
