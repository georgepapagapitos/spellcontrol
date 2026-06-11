import { type JSX, useId } from 'react';
import './DonorOutcomeInline.css';
import { DeckCardRow } from './DeckCardRow';
import { useSimilarCards } from './useSimilarCards';
import type { DonorOutcome } from '@/lib/allocations';
import type { Deck } from '@/store/decks';
import type { Change, ChangeOwnership } from '@/lib/deck-change';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types';
import type { SimilarCandidate } from '@/lib/similar-cards';

export interface DonorOutcomeInlineProps {
  /** The deck losing the physical copy (donor). Source of identity/inclusion. */
  donorDeck: Deck;
  /** The card leaving the donor — the target for replacement suggestions. */
  donorCard: ScryfallCard;
  collectionCards: EnrichedCard[];
  ownershipFor: (name: string) => ChangeOwnership;
  freeCountFor: (name: string) => number;
  /** Commander/partner donor slots can only be freed — hide replace/remove. */
  canReplaceOrRemove: boolean;
  selected: DonorOutcome;
  onSelect: (outcome: DonorOutcome) => void;
  /** The chosen replacement (only meaningful when `selected === 'replace'`). */
  replacement: { name: string; card: ScryfallCard } | null;
  onSelectReplacement: (name: string, card: ScryfallCard) => void;
}

/** Minimal Change for a DeckCardRow — mirrors SimilarCardsStrip's bridge. */
function toChange(c: SimilarCandidate): Change {
  return {
    id: `donor-replace:${c.name}`,
    type: 'add',
    lane: 'similar',
    name: c.name,
    card: c.card,
    ownership: c.ownership,
    inclusion: c.inclusion,
    imageUrl: c.card.image_uris?.normal,
    reason:
      (c.freeCount ?? 0) > 0 ? `${c.freeCount} free in your collection` : 'Plays a similar role',
    cmc: c.card.cmc,
    typeLine: c.card.type_line,
  };
}

/** All names already in the donor deck — never suggested as a replacement. */
function donorDeckNames(deck: Deck): string[] {
  const names = [
    ...deck.cards.map((c) => c.card.name),
    ...(deck.sideboard ?? []).map((c) => c.card.name),
  ];
  if (deck.commander) names.push(deck.commander.name);
  if (deck.partnerCommander) names.push(deck.partnerCommander.name);
  return names;
}

/**
 * The three-way "what happens to the donor deck" chooser, shared by the
 * steal-on-add and move-to-another-deck flows. The user always picks this
 * explicitly — nothing moves silently.
 *
 *  - leave-gap (default): the donor keeps the card as an unowned copy it still
 *    needs (the truthful physical state).
 *  - replace: fill the gap with another card the user OWNS (owned-only
 *    suggestions — replacing with an unowned card would just make a new gap).
 *  - remove: drop the card from the donor entirely.
 *
 * Commander/partner donor slots can only be freed (`canReplaceOrRemove=false`),
 * since the commander has no list slot to replace or remove.
 */
export function DonorOutcomeInline({
  donorDeck,
  donorCard,
  collectionCards,
  ownershipFor,
  freeCountFor,
  canReplaceOrRemove,
  selected,
  onSelect,
  replacement,
  onSelectReplacement,
}: DonorOutcomeInlineProps): JSX.Element {
  const groupName = useId();
  const identity = donorDeck.commander?.color_identity ?? [];

  const { owned, loading } = useSimilarCards({
    target: donorCard,
    deckCardNames: donorDeckNames(donorDeck),
    collectionCards,
    ownershipFor,
    freeCountFor,
    identity,
    inclusionMap: donorDeck.cardInclusionMap ?? {},
    enabled: canReplaceOrRemove && selected === 'replace',
  });

  if (!canReplaceOrRemove) {
    return (
      <p className="donor-outcome-note">
        Your copy leaves <strong>{donorDeck.name}</strong>. It keeps{' '}
        <strong>{donorCard.name}</strong> as a card you still need.
      </p>
    );
  }

  const options: { value: DonorOutcome; label: string; hint: string }[] = [
    {
      value: 'leave-gap',
      label: 'Leave a gap',
      hint: `${donorDeck.name} keeps it as a copy you still need`,
    },
    { value: 'replace', label: 'Replace it', hint: 'Fill the gap with a card you own' },
    { value: 'remove', label: 'Remove it', hint: `Drop it from ${donorDeck.name}` },
  ];

  return (
    <div className="donor-outcome">
      <p className="donor-outcome-prompt">
        What about <strong>{donorDeck.name}</strong>?
      </p>
      <div
        className="donor-outcome-options"
        role="radiogroup"
        aria-label="What about the other deck?"
      >
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`donor-outcome-option${selected === opt.value ? ' is-selected' : ''}`}
          >
            <input
              type="radio"
              name={groupName}
              value={opt.value}
              checked={selected === opt.value}
              onChange={() => onSelect(opt.value)}
            />
            <span className="donor-outcome-option-text">
              <span className="donor-outcome-option-label">{opt.label}</span>
              <span className="donor-outcome-option-hint">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {selected === 'replace' && (
        <div className="donor-outcome-replace">
          {loading && owned.length === 0 ? (
            <p className="donor-outcome-replace-empty">Finding cards you own…</p>
          ) : owned.length === 0 ? (
            <p className="donor-outcome-replace-empty">
              No owned alternatives found — pick another option above.
            </p>
          ) : (
            <ul className="donor-outcome-replace-list">
              {owned.map((c) => (
                <DeckCardRow
                  key={c.name}
                  change={toChange(c)}
                  commanderName={donorDeck.commander?.name}
                  actLabel={replacement?.name === c.name ? 'Chosen' : 'Use this'}
                  onAct={() => onSelectReplacement(c.name, c.card)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
