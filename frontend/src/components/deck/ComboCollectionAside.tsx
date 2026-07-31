import { useState } from 'react';
import { Library, Crown } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { toast } from '../../store/toasts';
import type { EnrichedCard } from '../../types';
import type { ComboCardRef } from '../../types/combos';
import type { CardLocation } from '../../lib/card-locations';

const SHOWN_COMMANDERS = 3;
/**
 * Past this many hosts, the exact count stops being useful information — a
 * mono-colour combo in a large collection can legally sit under hundreds of
 * commanders, and "419 commanders you own can run this" reads as noise, not a
 * fact worth leading with. Below the threshold the count is still a real,
 * useful number.
 */
const MANY_HOSTS = 20;

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
  const [seeding, setSeeding] = useState<string | null>(null);
  const navigate = useNavigate();

  /**
   * Open the deck builder seeded with this commander and the combo's pieces
   * pinned as must-includes.
   *
   * The collection row is an `EnrichedCard`, but the builder's prefill wants a
   * full `ScryfallCard`, so one lookup is unavoidable here. It's a single card
   * and it's cached, but it IS a round-trip — hence the pending label and the
   * disabled state rather than a silently unresponsive button.
   */
  const seed = async (commander: EnrichedCard) => {
    if (seeding) return;
    setSeeding(commander.name);
    try {
      const resolved = await getCardByName(commander.name);
      if (!resolved) throw new Error(`Couldn't find a printing for ${commander.name}.`);
      navigate('/decks/new', {
        state: {
          prefill: {
            commander: resolved,
            mustIncludeCards: cards.map((c) => c.cardName),
          },
        },
      });
    } catch (err) {
      toast.show({
        message:
          err instanceof Error ? err.message : `Couldn't open a build for ${commander.name}.`,
        tone: 'error',
      });
      setSeeding(null);
    }
  };

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
            {hosts.length > 1 && hosts.length <= MANY_HOSTS
              ? `${hosts.length} commanders you own can run this:`
              : null}
            {hosts.length > MANY_HOSTS ? 'Best commanders you own for this:' : null}
          </span>{' '}
          <span className="combo-aside-names">
            {shown.map((c, i) => (
              <span key={c.name}>
                {i > 0 && ', '}
                <button
                  type="button"
                  className="btn-link combo-aside-host"
                  onClick={() => void seed(c)}
                  disabled={seeding !== null}
                  title={`Build a ${c.name} deck around this combo`}
                >
                  {c.name}
                </button>
                {seeding === c.name && <span className="combo-aside-page"> — opening…</span>}
              </span>
            ))}
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
