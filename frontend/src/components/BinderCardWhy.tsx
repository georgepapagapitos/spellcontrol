import { Notebook } from 'lucide-react';
import { explainPlacement } from '../lib/binder-why';
import type { BinderDef, EnrichedCard, MaterializedBinder } from '../types';
import './BinderCardWhy.css';

/**
 * Why this card is in this binder, as the card preview's lead section: the
 * rule that filed it (or the pin, the price margin, its other printings), and
 * the one other binder most likely asked about. Renders nothing when the
 * binder carries no reason for the card.
 */
export function BinderCardWhy({
  card,
  binder,
  defs,
}: {
  card: EnrichedCard;
  binder: MaterializedBinder;
  defs: BinderDef[];
}) {
  const why = explainPlacement(card, binder, defs);
  if (!why) return null;
  return (
    <div className="binder-card-why">
      <Notebook
        className="binder-card-why-icon"
        width={14}
        height={14}
        strokeWidth={1.8}
        aria-hidden
      />
      <p className="binder-card-why-text">
        <span>{why.reason}</span>
        {why.also && <span className="binder-card-why-also">{why.also}</span>}
      </p>
    </div>
  );
}
