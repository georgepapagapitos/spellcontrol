import { ImageOff } from 'lucide-react';
import './DeckCardRail.css';
import { ManaCost } from '../ManaCost';
import { formatMoney } from '../../lib/format-money';
import type { CurrencyCode } from './deck-display-rows';
import { frontFaceMana } from './deck-display-rows';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

export interface DeckCardRailCard {
  name: string;
  card: ScryfallCard;
  imageUrl?: string;
  /** Row aggregate (qty × unit), like the list row's own price cell. */
  price: number;
  qty: number;
}

/**
 * The pinned card rail (2026-09-19) — a sticky column beside the deck list
 * on wide, hover-capable screens that shows whichever card the pointer last
 * rested on (the commander until then). It replaces the floating hover-peek
 * at that width: the list rows can stay sparse (qty · name · mana · price)
 * because everything else about a card lives here, one hover away, in the
 * space a 2000px display otherwise spent on empty sixth and seventh columns.
 * Moxfield and Archidekt both do this; users arriving from either expect it.
 *
 * Click the art to open the full card preview — same path as clicking the
 * row. Presentational otherwise: the rail never owns the hover state (that
 * stays with `useDeckHoverPeek`, so the touch/narrow paths are untouched).
 */
export function DeckCardRail({
  card,
  currency,
  onOpen,
}: {
  card: DeckCardRailCard | null;
  currency: CurrencyCode;
  onOpen?: (name: string) => void;
}) {
  if (!card) {
    return (
      <aside className="deck-card-rail" aria-label="Card preview">
        <div className="deck-card-rail-empty" aria-hidden>
          <ImageOff width={22} height={22} strokeWidth={1.75} />
          <span>Hover a card to see it here</span>
        </div>
      </aside>
    );
  }
  const mana = frontFaceMana(card.card);
  const typeLine = getFrontFaceTypeLine(card.card);
  return (
    <aside className="deck-card-rail" aria-label="Card preview" aria-live="polite">
      <button
        type="button"
        className="deck-card-rail-art"
        aria-label={`Open ${card.name}`}
        onClick={() => onOpen?.(card.name)}
      >
        {card.imageUrl ? (
          <img src={card.imageUrl} alt="" draggable={false} />
        ) : (
          <div className="deck-card-rail-missing" aria-hidden>
            <ImageOff width={22} height={22} strokeWidth={1.75} />
            <span>No art</span>
          </div>
        )}
      </button>
      <div className="deck-card-rail-caption">
        <div className="deck-card-rail-title-row">
          <span className="deck-card-rail-name">{card.name}</span>
          {mana && <ManaCost cost={mana} className="deck-card-rail-mana" />}
        </div>
        <div className="deck-card-rail-meta">
          {typeLine && <span className="deck-card-rail-type">{typeLine}</span>}
          {card.price > 0 && (
            <span
              className="deck-card-rail-price"
              title={
                card.qty > 1
                  ? `${formatMoney(card.price / card.qty, { currency })} each`
                  : undefined
              }
            >
              {formatMoney(card.price, { currency })}
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
