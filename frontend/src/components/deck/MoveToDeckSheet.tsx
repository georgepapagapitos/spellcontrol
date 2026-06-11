import { type JSX, useId, useState } from 'react';
import { X, ChevronLeft } from 'lucide-react';
import './MoveToDeckSheet.css';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useEscapeKey } from '../../lib/use-escape-key';
import { ColorPip } from '../shared/ManaSymbol';
import { effectiveDeckColors } from '@/lib/deck-validation';
import { useDecksStore, type Deck } from '@/store/decks';
import { DonorOutcomeInline } from './DonorOutcomeInline';
import type { DonorOutcome } from '@/lib/allocations';
import type { ChangeOwnership } from '@/lib/deck-change';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types';

export interface MoveToDeckSheetProps {
  /** The card being moved out of the current (donor) deck. */
  card: ScryfallCard;
  /** The deck the card is leaving — the donor for the outcome chooser. */
  currentDeck: Deck;
  collectionCards: EnrichedCard[];
  ownershipFor: (name: string) => ChangeOwnership;
  freeCountFor: (name: string) => number;
  onConfirm: (
    targetDeckId: string,
    outcome: DonorOutcome,
    replacement: { name: string; card: ScryfallCard } | null
  ) => void;
  onCancel: () => void;
}

function deckArt(deck: Deck): string | undefined {
  return (
    deck.commander?.image_uris?.art_crop ?? deck.commander?.card_faces?.[0]?.image_uris?.art_crop
  );
}

/**
 * Surface 2 of the physical-copy reallocation feature: move an owned card from
 * the current deck into another deck. Two phases — pick the destination deck,
 * then choose what happens to THIS deck (the donor): leave a gap / replace /
 * remove. Nothing moves until the final confirm.
 *
 * Uses the shared `card-picker` sheet shell (bottom sheet on mobile, centered
 * modal ≥1024px); the deck list mirrors the decks-index tile (art / color pips
 * / count).
 */
export function MoveToDeckSheet({
  card,
  currentDeck,
  collectionCards,
  ownershipFor,
  freeCountFor,
  onConfirm,
  onCancel,
}: MoveToDeckSheetProps): JSX.Element {
  const titleId = useId();
  const decks = useDecksStore((s) => s.decks);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DonorOutcome>('leave-gap');
  const [replacement, setReplacement] = useState<{ name: string; card: ScryfallCard } | null>(null);

  useLockBodyScroll();
  useEscapeKey(onCancel);

  const others = decks.filter((d) => d.id !== currentDeck.id);
  const target = targetId ? (others.find((d) => d.id === targetId) ?? null) : null;

  const handleSelect = (next: DonorOutcome) => {
    setOutcome(next);
    if (next !== 'replace') setReplacement(null);
  };

  const confirmDisabled = outcome === 'replace' && !replacement;

  return (
    <div
      className="card-picker-root move-deck-root"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet move-deck-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <header className="move-deck-head">
          {target && (
            <button
              type="button"
              className="move-deck-back"
              onClick={() => {
                setTargetId(null);
                setReplacement(null);
                setOutcome('leave-gap');
              }}
              aria-label="Back to deck list"
            >
              <ChevronLeft width={18} height={18} strokeWidth={2} aria-hidden />
            </button>
          )}
          <div className="move-deck-titles">
            <h2 id={titleId} className="move-deck-title">
              {target ? `Move to ${target.name}?` : 'Move to another deck'}
            </h2>
            <p className="move-deck-sub">
              Moving <strong>{card.name}</strong>
              {target ? null : ' out of this deck'}
            </p>
          </div>
          <button type="button" className="move-deck-close" onClick={onCancel} aria-label="Cancel">
            <X width={18} height={18} strokeWidth={2} aria-hidden />
          </button>
        </header>

        {!target ? (
          others.length === 0 ? (
            <div className="move-deck-empty">You have no other decks to move this into.</div>
          ) : (
            <ul className="move-deck-list" role="list">
              {others.map((d) => {
                const art = deckArt(d);
                const colors = Array.from(effectiveDeckColors(d));
                const total = (d.commander ? 1 : 0) + (d.partnerCommander ? 1 : 0) + d.cards.length;
                return (
                  <li key={d.id} className="move-deck-row">
                    <button
                      type="button"
                      className="move-deck-row-btn"
                      style={{ ['--deck-color' as string]: d.color }}
                      onClick={() => setTargetId(d.id)}
                      aria-label={`Move ${card.name} to ${d.name}`}
                    >
                      {art ? (
                        <img className="move-deck-row-art" src={art} alt="" aria-hidden />
                      ) : (
                        <span className="move-deck-row-swatch" aria-hidden>
                          {colors.map((c) => (
                            <ColorPip key={c} color={c} />
                          ))}
                        </span>
                      )}
                      <span className="move-deck-row-text">
                        <span className="move-deck-row-name">{d.name}</span>
                        <span className="move-deck-row-count">
                          {total} {total === 1 ? 'card' : 'cards'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <>
            <div className="move-deck-body">
              <DonorOutcomeInline
                donorDeck={currentDeck}
                donorCard={card}
                collectionCards={collectionCards}
                ownershipFor={ownershipFor}
                freeCountFor={freeCountFor}
                canReplaceOrRemove
                selected={outcome}
                onSelect={handleSelect}
                replacement={replacement}
                onSelectReplacement={(name, c) => setReplacement({ name, card: c })}
              />
            </div>
            <div className="move-deck-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  onConfirm(target.id, outcome, outcome === 'replace' ? replacement : null)
                }
                disabled={confirmDisabled}
              >
                Move to {target.name}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
