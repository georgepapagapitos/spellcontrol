import { type JSX, useId, useState } from 'react';
import { X, Layers } from 'lucide-react';
import './StealConfirmSheet.css';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useEscapeKey } from '../../lib/use-escape-key';
import { useDecksStore } from '@/store/decks';
import { DonorOutcomeInline } from './DonorOutcomeInline';
import type { DonorOutcome, StealableCopy } from '@/lib/allocations';
import type { ChangeOwnership } from '@/lib/deck-change';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types';

export interface StealConfirmSheetProps {
  /** The card being added to the current (recipient) deck. */
  card: ScryfallCard;
  /** Which physical copy would be pulled, and from where. */
  stealable: StealableCopy;
  collectionCards: EnrichedCard[];
  ownershipFor: (name: string) => ChangeOwnership;
  freeCountFor: (name: string) => number;
  /** Commit the move with the chosen donor outcome (+ replacement if any). */
  onConfirm: (
    outcome: DonorOutcome,
    replacement: { name: string; card: ScryfallCard } | null
  ) => void;
  /** Escape hatch: add an unowned/proxy copy here, leaving the donor untouched.
   *  Omit when there's no proxy alternative (e.g. binding an existing slot). */
  onAddAsProxy?: () => void;
  onCancel: () => void;
}

/**
 * Surface 1 of the physical-copy reallocation feature: when you add a card to a
 * deck but your only copies are all in OTHER decks, this confirms the move
 * explicitly before anything changes — what moves, from where, to here — and
 * lets you choose what happens to the donor deck (leave a gap / replace /
 * remove), or bail out by adding a proxy instead. Nothing moves silently.
 *
 * Uses the shared `card-picker` sheet shell (bottom sheet on mobile, centered
 * modal ≥1024px).
 */
export function StealConfirmSheet({
  card,
  stealable,
  collectionCards,
  ownershipFor,
  freeCountFor,
  onConfirm,
  onAddAsProxy,
  onCancel,
}: StealConfirmSheetProps): JSX.Element | null {
  const titleId = useId();
  const [outcome, setOutcome] = useState<DonorOutcome>('leave-gap');
  const [replacement, setReplacement] = useState<{ name: string; card: ScryfallCard } | null>(null);

  useLockBodyScroll();
  useEscapeKey(onCancel);

  const donorDeck = useDecksStore(
    (s) => s.decks.find((d) => d.id === stealable.donorDeckId) ?? null
  );
  // Donor deck vanished mid-flight (e.g. deleted in another tab) — nothing to steal.
  if (!donorDeck) return null;

  const canReplaceOrRemove = stealable.donorZone === 'main' || stealable.donorZone === 'sideboard';
  const needsReplacement = outcome === 'replace';
  const confirmDisabled = needsReplacement && !replacement;

  const handleSelect = (next: DonorOutcome) => {
    setOutcome(next);
    if (next !== 'replace') setReplacement(null);
  };

  return (
    <div
      className="card-picker-root steal-confirm-root"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet steal-confirm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <header className="steal-confirm-head">
          <div className="steal-confirm-titles">
            <h2 id={titleId} className="steal-confirm-title">
              Move this copy here?
            </h2>
            <p className="steal-confirm-sub">
              Your copy of <strong>{card.name}</strong> is in{' '}
              <span
                className="steal-confirm-donor"
                style={{ ['--deck-color' as string]: stealable.donorDeckColor }}
              >
                <Layers width={13} height={13} strokeWidth={2} aria-hidden />
                {stealable.donorDeckName}
              </span>
              .
            </p>
          </div>
          <button
            type="button"
            className="steal-confirm-close"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <X width={18} height={18} strokeWidth={2} aria-hidden />
          </button>
        </header>

        <div className="steal-confirm-body">
          <DonorOutcomeInline
            donorDeck={donorDeck}
            donorCard={stealable.donorCard}
            collectionCards={collectionCards}
            ownershipFor={ownershipFor}
            freeCountFor={freeCountFor}
            canReplaceOrRemove={canReplaceOrRemove}
            selected={outcome}
            onSelect={handleSelect}
            replacement={replacement}
            onSelectReplacement={(name, c) => setReplacement({ name, card: c })}
          />
        </div>

        <div className="steal-confirm-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onConfirm(outcome, needsReplacement ? replacement : null)}
            disabled={confirmDisabled}
          >
            Move it here
          </button>
          {onAddAsProxy && (
            <button type="button" className="btn" onClick={onAddAsProxy}>
              Add a proxy here instead
            </button>
          )}
          <button type="button" className="steal-confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
