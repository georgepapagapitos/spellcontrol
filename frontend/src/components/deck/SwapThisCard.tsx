import './SwapThisCard.css';
import { DeckCardRow } from './DeckCardRow';
import type { Change } from '@/lib/deck-change';

export interface SwapThisCardProps {
  /** The in-deck card being looked at (the swap-out target). */
  currentName: string;
  /** Same-role replacement candidates, owned-first (normalized Changes). */
  alternatives: Change[];
  /** Swap the current card for the named alternative (cut + add). */
  onSwap: (name: string) => void;
  /** A swap is in flight — disables every row's action. */
  swapping?: boolean;
  /** Commander name, for the inclusion line wording. */
  commanderName?: string;
}

/**
 * The in-context "Swap this card" section, injected into the card-preview panel
 * for a card already in the deck. A complement to the Tune lanes (which answer
 * "what to change across the deck"): this answers "I'm looking at THIS card —
 * what replaces it", scoped to the card's role, owned-first. Rows go through the
 * shared <DeckCardRow> over the Change model, so this view and the lanes can
 * never disagree about a recommendation.
 */
export function SwapThisCard({
  currentName,
  alternatives,
  onSwap,
  swapping,
  commanderName,
}: SwapThisCardProps): JSX.Element | null {
  if (alternatives.length === 0) return null;

  return (
    <section className="swap-this-card" aria-label={`Swap ${currentName}`}>
      <h4 className="swap-this-card-title">Swap this card</h4>
      <p className="swap-this-card-sub">
        Same-role alternatives — owned first. Swapping keeps your deck size.
      </p>
      <ul className="swap-this-card-list">
        {alternatives.map((change) => (
          <DeckCardRow
            key={change.id}
            change={change}
            commanderName={commanderName}
            actLabel="Swap in"
            onAct={() => onSwap(change.name)}
            acting={swapping}
          />
        ))}
      </ul>
    </section>
  );
}
