import './CardName.css';
import type { JSX } from 'react';
import { flavorNameOf, type PrintingNameFields } from '@spellcontrol/binder-routing';

export interface CardNameProps {
  card: PrintingNameFields;
  /** Oracle name on its own line under the printed one, for a header with the height for it. */
  stacked?: boolean;
  /**
   * Lead with the oracle name and keep the printed one after it, quieter. A
   * decklist is read by the name the rules and every other tool use; a
   * collection or binder leads with what is on the card in your hand.
   */
  oracleFirst?: boolean;
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
export function CardName({ card, stacked, oracleFirst }: CardNameProps): JSX.Element {
  const flavor = flavorNameOf(card);
  if (!flavor) return <>{card.name}</>;
  if (oracleFirst) {
    return (
      <span className="card-name is-oracle-first" title={flavor}>
        <span className="card-name-oracle">{card.name}</span>
        <span className="card-name-sep">, </span>
        <span className="card-name-printed">{flavor}</span>
      </span>
    );
  }
  return (
    <span className={stacked ? 'card-name is-stacked' : 'card-name'} title={card.name}>
      <span className="card-name-printed">{flavor}</span>
      <span className="card-name-sep">, </span>
      <span className="card-name-oracle">{card.name}</span>
    </span>
  );
}
