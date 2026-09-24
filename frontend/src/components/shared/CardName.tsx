import './CardName.css';
import type { JSX } from 'react';
import { flavorNameOf, type PrintingNameFields } from '@spellcontrol/binder-routing';

export interface CardNameProps {
  card: PrintingNameFields;
  /** Oracle name on its own line under the printed one, for a header with the height for it. */
  stacked?: boolean;
}

/**
 * A card's name as it is printed on the card. A flavor-named printing ("A
 * Promise Fulfilled", the Final Fantasy Light Up the Stage) leads with that
 * and keeps its oracle name alongside in a quieter tone, because the oracle
 * name is what the rules, the deck checks and every other tool call it.
 *
 * Inline by default, so a fixed-height row (the virtualized collection table)
 * keeps its height: the oracle name takes whatever width is left and truncates
 * before the printed name does. Every other card renders as its bare name, with
 * no wrapper at all.
 */
export function CardName({ card, stacked }: CardNameProps): JSX.Element {
  const flavor = flavorNameOf(card);
  if (!flavor) return <>{card.name}</>;
  return (
    <span className={stacked ? 'card-name is-stacked' : 'card-name'} title={card.name}>
      <span className="card-name-printed">{flavor}</span>
      <span className="card-name-sep">, </span>
      <span className="card-name-oracle">{card.name}</span>
    </span>
  );
}
