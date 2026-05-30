import { DeckCurvePhases } from './DeckCurvePhases';
import { DeckColorPanel } from './DeckColorPanel';
import { DeckTypeBreakdown } from './DeckTypeBreakdown';
import type { CardTally } from './useCardCarousel';
import './DeckManaPanel.css';

export interface DeckManaData {
  manaCurve: Record<number, number>;
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
 * The deck's full "mana story" — curve + unified color view + type breakdown.
 * Rendered in the "Mana" tab of the analysis surface at full width on every
 * device: a single stacked column on phones, and a 2-column grid from 640px
 * where the curve spans the top row and Color + Types pair beneath it (see
 * DeckManaPanel.css). Pure render; all computation happens upstream in
 * DeckDisplay.
 */
export function DeckManaPanel({
  manaCurve,
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
      <section className="deck-stats-panel">
        <h4 className="deck-stats-panel-title">Mana curve</h4>
        <DeckCurvePhases manaCurve={manaCurve} averageCmc={averageCmc} cardsByCmc={cardsByCmc} />
      </section>
      <section className="deck-stats-panel">
        <h4 className="deck-stats-panel-title">Color</h4>
        <DeckColorPanel
          colorDist={colorDist}
          manaProduction={manaProduction}
          cardsByColor={cardsByColor}
        />
      </section>
      <section className="deck-stats-panel">
        <h4 className="deck-stats-panel-title">Types</h4>
        <DeckTypeBreakdown typeCounts={typeBreakdown} cardsByType={cardsByType} />
      </section>
    </div>
  );
}
