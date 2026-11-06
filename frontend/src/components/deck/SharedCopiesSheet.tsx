import { type JSX } from 'react';
import { Layers, Boxes } from 'lucide-react';
import { Sheet } from '@/components/overlays/Sheet';
import './SharedCopiesSheet.css';
import type { ContestedCard } from '@/lib/collection/allocations';
import { Button } from '@/components/shared/Button';

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
  return (
    <Sheet
      onClose={onClose}
      rootClassName="shared-copies-root"
      className="shared-copies-sheet"
      footerClassName="shared-copies-actions"
      title="Shared with your other decks"
      description={
        <>
          These cards are in <strong>{deckName}</strong>'s list, but their copies are committed to
          other decks.
        </>
      }
      closeButton
      footer={(close) => (
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      )}
    >
      {contested.length === 0 ? (
        <div className="shared-copies-empty">Every copy this deck needs is assigned here.</div>
      ) : (
        <ul className="shared-copies-list" role="list">
          {contested.map((c) => (
            <li key={c.slotId} className="shared-copies-row">
              <span className="text-stack">
                <span className="truncate-name">{c.cardName}</span>
                <span className="shared-copies-row-where">
                  {c.donorKind === 'cube' ? (
                    <Boxes width={14} height={14} strokeWidth={1.8} aria-hidden />
                  ) : (
                    <Layers width={14} height={14} strokeWidth={1.8} aria-hidden />
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
              <Button onClick={() => onMove(c.slotId)} className="shared-copies-row-btn">
                Move here…
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
