import type { JSX } from 'react';
import './SimilarCardsStrip.css';
import { DeckCardRow } from './DeckCardRow';
import { useSimilarCards } from './useSimilarCards';
import { toSwapAgainst, type Change, type ChangeOwnership } from '@/lib/deck-change';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types';
import type { SimilarCandidate } from '@/lib/similar-cards';

export interface SimilarCardsStripProps {
  /** The full focused deck card (carries oracle text — must already be resolved). */
  target: ScryfallCard;
  /** All card names currently in the deck — never re-suggested. */
  deckCardNames: string[];
  /** The user's collection, one entry per physical copy. */
  collectionCards: EnrichedCard[];
  /** Render-time ownership for a card name — never cached. */
  ownershipFor: (name: string) => ChangeOwnership;
  /** Free (unallocated) copy count for a card name. */
  freeCountFor: (name: string) => number;
  /** Commander color identity — gates both passes. */
  identity: string[];
  /** EDHREC inclusion % by card name for this commander. */
  inclusionMap: Record<string, number>;
  /** Swap the focused card for the named candidate (cut + add). */
  onSwap: (name: string) => void;
  /** Tap the thumbnail → open the card in the carousel. Only wired when present. */
  onPreview?: (name: string, card: ScryfallCard) => void;
  /** A swap is in flight — disables every row's action button. */
  swapping?: boolean;
  /** Commander name, for the inclusion line wording. */
  commanderName?: string;
  /** Gate: only do work when the carousel is open in deck view. */
  enabled: boolean;
}

/** Build a human-readable reason line for a SimilarCandidate row. */
function buildReason(c: SimilarCandidate, group: 'owned' | 'discovery'): string {
  if (group === 'owned' && (c.freeCount ?? 0) > 0) {
    return `${c.freeCount} free in your collection`;
  }
  if (c.sharedAxes.length > 0) {
    return `Plays like this — shares your ${c.sharedAxes[0]} engine`;
  }
  return 'Similar role & curve';
}

/** Build the INCOMING add-Change for a SimilarCandidate. The caller promotes it
 *  to a real `type:'swap'` against the focused card via `toSwapAgainst`, so the
 *  row renders the trade (focused card → this candidate) in <DeckCardRow>. */
function toChange(c: SimilarCandidate, group: 'owned' | 'discovery'): Change {
  return {
    id: `similar:${group}:${c.name}`,
    type: 'add',
    lane: 'similar',
    name: c.name,
    card: c.card,
    ownership: c.ownership,
    inclusion: c.inclusion,
    imageUrl: c.card.image_uris?.normal,
    reason: buildReason(c, group),
    cmc: c.card.cmc,
    typeLine: c.card.type_line,
  };
}

/**
 * The "Similar cards" section for the card-preview carousel panel.
 *
 * Surfaces replacement / discovery suggestions for the currently focused deck
 * card in two groups — owned cards from the collection first, then broader
 * discovery. Uses the same <DeckCardRow> shared row as "Swap this card" so
 * the two sections look and behave consistently. Delegates all sourcing to
 * <useSimilarCards>; this component is purely presentational.
 */
export function SimilarCardsStrip({
  target,
  deckCardNames,
  collectionCards,
  ownershipFor,
  freeCountFor,
  identity,
  inclusionMap,
  onSwap,
  onPreview,
  swapping,
  commanderName,
  enabled,
}: SimilarCardsStripProps): JSX.Element | null {
  const { owned, discovery, loading } = useSimilarCards({
    target,
    deckCardNames,
    collectionCards,
    ownershipFor,
    freeCountFor,
    identity,
    inclusionMap,
    enabled,
  });

  if (!loading && owned.length === 0 && discovery.length === 0) return null;

  // Bridge: the page-level onPreview is (name, card) → void, but DeckCardRow
  // delivers onPreview as (change: Change) → void. Adapt per-candidate so we
  // always have the right ScryfallCard in scope.
  function makeRowPreview(c: SimilarCandidate): ((change: Change) => void) | undefined {
    if (!onPreview) return undefined;
    return (_change: Change) => onPreview(c.name, c.card);
  }

  return (
    <section className="similar-cards" aria-label={`Cards like ${target.name}`}>
      <h4 className="similar-cards-title">Similar cards</h4>

      {owned.length > 0 && (
        <div className="similar-cards-group">
          <span className="similar-cards-group-label">From your collection</span>
          <ul className="similar-cards-list">
            {owned.map((c) => (
              <DeckCardRow
                key={`owned:${c.name}`}
                change={toSwapAgainst(toChange(c, 'owned'), target.name)}
                commanderName={commanderName}
                actLabel="Swap in"
                onAct={() => onSwap(c.name)}
                acting={swapping}
                onPreview={makeRowPreview(c)}
              />
            ))}
          </ul>
        </div>
      )}

      {(discovery.length > 0 || loading) && (
        <div className="similar-cards-group">
          <span className="similar-cards-group-label">Cards like this</span>
          {loading && discovery.length === 0 ? (
            <p className="similar-cards-loading">Finding similar cards…</p>
          ) : (
            <ul className="similar-cards-list">
              {discovery.map((c) => (
                <DeckCardRow
                  key={`discovery:${c.name}`}
                  change={toSwapAgainst(toChange(c, 'discovery'), target.name)}
                  commanderName={commanderName}
                  actLabel="Swap in"
                  onAct={() => onSwap(c.name)}
                  acting={swapping}
                  onPreview={makeRowPreview(c)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
