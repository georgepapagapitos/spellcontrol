import { DeckCurvePhases } from './DeckCurvePhases';
import { DeckColorPanel } from './DeckColorPanel';
import { DeckTypeBreakdown } from './DeckTypeBreakdown';
import './DeckManaPanel.css';

export interface DeckManaData {
  manaCurve: Record<number, number>;
  averageCmc: number;
  colorDist: { counts: Record<string, number>; total: number };
  manaProduction: { counts: Record<string, number>; total: number };
  typeBreakdown: Record<string, number>;
}

/**
 * The deck's full "mana story" — curve + unified color view + type breakdown —
 * as one stacked unit. Rendered two ways off the same data: a persistent
 * right-hand column on desktop (≥1101px) and the "Mana" tab of the analysis
 * surface on narrower screens. Pure render; all computation happens upstream in
 * DeckDisplay so the desktop column and the mobile tab can't drift apart.
 */
export function DeckManaPanel({
  manaCurve,
  averageCmc,
  colorDist,
  manaProduction,
  typeBreakdown,
}: DeckManaData): JSX.Element {
  return (
    <div className="deck-mana-panel">
      <section className="deck-stats-panel">
        <h4 className="deck-stats-panel-title">Mana curve</h4>
        <DeckCurvePhases manaCurve={manaCurve} averageCmc={averageCmc} />
      </section>
      <section className="deck-stats-panel">
        <h4 className="deck-stats-panel-title">Color</h4>
        <DeckColorPanel colorDist={colorDist} manaProduction={manaProduction} />
      </section>
      <section className="deck-stats-panel">
        <h4 className="deck-stats-panel-title">Types</h4>
        <DeckTypeBreakdown typeCounts={typeBreakdown} />
      </section>
    </div>
  );
}
