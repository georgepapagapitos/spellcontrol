import { type JSX, useId } from 'react';
import { X, Layers, Boxes } from 'lucide-react';
import './SharedCopiesSheet.css';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useEscapeKey } from '../../lib/use-escape-key';
import type { ContestedCard } from '@/lib/allocations';

export interface SharedCopiesSheetProps {
  /** This deck's name (for the header). */
  deckName: string;
  /** Owned-but-elsewhere cards in this deck — from `listContestedCards`. */
  contested: ContestedCard[];
  /** Begin a conscious move of one card into this deck (opens the steal sheet). */
  onMove: (slotId: string) => void;
  onClose: () => void;
}

/**
 * Shared-copies review: the deck-level, conscious counterpart to the per-row
 * "Use my copy". Lists every card this deck wants whose only physical copies are
 * in your other decks, with an honest shortage line, and lets you pull each one
 * in one at a time — each "Move here" opens the steal sheet so YOU decide what the
 * donor deck does. Nothing moves in bulk and nothing moves without that choice.
 *
 * Reuses the shared `card-picker` sheet shell (bottom sheet on mobile, centered
 * modal ≥1024px). Resolved cards drop off the list as the deck state updates.
 */
export function SharedCopiesSheet({
  deckName,
  contested,
  onMove,
  onClose,
}: SharedCopiesSheetProps): JSX.Element {
  const titleId = useId();
  useLockBodyScroll();
  useEscapeKey(onClose);

  return (
    <div
      className="card-picker-root shared-copies-root"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet shared-copies-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <header className="shared-copies-head">
          <div className="shared-copies-titles">
            <h2 id={titleId} className="shared-copies-title">
              Shared with your other decks
            </h2>
            <p className="shared-copies-sub">
              These cards are in <strong>{deckName}</strong>'s list, but their copies are committed
              elsewhere. A physical copy can only be in one deck — pull one in when you want it
              here.
            </p>
          </div>
          <button
            type="button"
            className="shared-copies-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X width={18} height={18} strokeWidth={2} aria-hidden />
          </button>
        </header>

        {contested.length === 0 ? (
          <div className="shared-copies-empty">Every copy this deck needs is assigned here. 🎉</div>
        ) : (
          <ul className="shared-copies-list" role="list">
            {contested.map((c) => (
              <li key={c.slotId} className="shared-copies-row">
                <span className="shared-copies-row-text">
                  <span className="shared-copies-row-name">{c.cardName}</span>
                  <span className="shared-copies-row-where">
                    {c.donorKind === 'cube' ? (
                      <Boxes width={13} height={13} strokeWidth={2} aria-hidden />
                    ) : (
                      <Layers width={13} height={13} strokeWidth={2} aria-hidden />
                    )}
                    You own {c.owned} · also in {c.donorKind === 'cube' ? 'cube' : 'deck'}{' '}
                    <span
                      className="shared-copies-row-deck"
                      style={{ ['--deck-color' as string]: c.donorDeckColor }}
                    >
                      {c.donorDeckName}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm shared-copies-row-btn"
                  onClick={() => onMove(c.slotId)}
                >
                  Move here…
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="shared-copies-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
