import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { commanderTaxAmount } from '../lib/zones';

interface Props {
  zone: Zone;
  label: string;
  cards: PlaytestCard[];
  /** Only meaningful for the command zone — omit elsewhere. */
  commanderTax?: Record<string, number>;
  onClick(): void;
  /**
   * One action offered on the tile itself rather than behind the viewer —
   * the library's "Draw". Rendered as its own button, which is why the tile
   * root is a div: a button inside a button is invalid markup and a screen
   * reader would never reach the inner one.
   */
  action?: { label: string; shortcut?: string; onClick(): void; disabled?: boolean };
}

export function ZonePile({ zone, label, cards, commanderTax, onClick, action }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone}` });
  const top = cards[cards.length - 1];
  // Tracks the id of a card whose image failed, so a new top card (the pile
  // shuffles/draws constantly) always gets a fresh chance to load.
  const [erroredId, setErroredId] = useState<string | null>(null);
  const tax = zone === 'command' ? commanderTaxAmount(commanderTax ?? {}, top?.id) : 0;
  return (
    <div ref={setNodeRef} className={`playtest-pile${isOver ? ' is-over' : ''}`}>
      <button
        type="button"
        onClick={onClick}
        className="playtest-pile__open"
        aria-label={`${label} (${cards.length} cards)${tax > 0 ? `, tax +${tax}` : ''}`}
      >
        {/* The count rides in the label, so each tile is one line of text over
            its art and four of them fit a bottom-right corner row. */}
        <span className="playtest-pile__label">
          {label} ({cards.length})
        </span>
        <span className="playtest-pile__stack">
          {top && zone !== 'library' && top.imageUrl && top.id !== erroredId ? (
            <img
              src={top.imageUrl}
              alt={top.name}
              draggable={false}
              loading="lazy"
              decoding="async"
              onError={() => setErroredId(top.id)}
            />
          ) : (
            <span className={`playtest-pile__back playtest-pile__back--${zone}`} />
          )}
          {tax > 0 && (
            <span className="playtest-pile__tax" aria-hidden>
              Tax +{tax}
            </span>
          )}
        </span>
      </button>
      {action && (
        <button
          type="button"
          className="playtest-pile__action"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
          {action.shortcut && <kbd>{action.shortcut}</kbd>}
        </button>
      )}
    </div>
  );
}
