import { useState } from 'react';
import { Library, Crown } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EnrichedCard } from '../../types';
import type { ComboCardRef } from '../../types/combos';
import type { CardLocation } from '../../lib/card-locations';

const SHOWN_COMMANDERS = 3;

interface Props {
  /** The combo's pieces, so each can be located in the binders. */
  cards: ComboCardRef[];
  /** Commanders in the collection whose identity can host this combo. */
  hosts: EnrichedCard[];
  /** oracleId → binder page, from `buildCardLocationIndex`. */
  locations: Map<string, CardLocation>;
}

/**
 * The collection-view payoff under each combo row: which of your commanders
 * could run it, and where its pieces physically live.
 *
 * Both are derived locally — hosts by colour-identity superset, locations from
 * the materialized binder layout — so this adds no requests to a list that can
 * already be hundreds of rows long.
 */
export function ComboCollectionAside({ cards, hosts, locations }: Props) {
  const [expanded, setExpanded] = useState(false);

  const located = cards
    .map((c) => ({ card: c, at: locations.get(c.oracleId) }))
    .filter((e): e is { card: ComboCardRef; at: CardLocation } => e.at !== undefined);

  const shown = expanded ? hosts : hosts.slice(0, SHOWN_COMMANDERS);
  const rest = hosts.length - shown.length;

  if (hosts.length === 0 && located.length === 0) return null;

  return (
    <div className="combo-aside">
      {hosts.length > 0 && (
        <p className="combo-aside-line">
          <Crown className="combo-aside-icon" width={12} height={12} aria-hidden />
          <span className="combo-aside-label">
            {hosts.length === 1 ? '1 commander you own can run this:' : null}
            {hosts.length > 1 ? `${hosts.length} commanders you own can run this:` : null}
          </span>{' '}
          <span className="combo-aside-names">
            {shown.map((c) => c.name).join(', ')}
            {rest > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  className="btn-link combo-aside-more"
                  onClick={() => setExpanded(true)}
                >
                  +{rest} more
                </button>
              </>
            )}
          </span>
        </p>
      )}

      {located.length > 0 && (
        <ul className="combo-aside-locations" role="list">
          {located.map(({ card, at }) => (
            <li key={card.oracleId} className="combo-aside-line">
              <Library className="combo-aside-icon" width={12} height={12} aria-hidden />
              <span className="combo-aside-names card-name-chip-text" title={card.cardName}>
                {card.cardName}
              </span>
              <span className="combo-aside-sep" aria-hidden>
                {' — '}
              </span>
              <Link className="combo-aside-binder" to={`/collection/binders/${at.binderId}`}>
                {at.binderName}
              </Link>
              <span className="combo-aside-page">, page {at.pageNum}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
