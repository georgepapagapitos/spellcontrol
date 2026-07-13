import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { PlaytestCard, Zone } from '@/lib/playtest';

interface Props {
  zone: Zone;
  label: string;
  cards: PlaytestCard[];
  onClick(): void;
}

export function ZonePile({ zone, label, cards, onClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone}` });
  const top = cards[cards.length - 1];
  // Tracks the id of a card whose image failed, so a new top card (the pile
  // shuffles/draws constantly) always gets a fresh chance to load.
  const [erroredId, setErroredId] = useState<string | null>(null);
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className={`playtest-pile${isOver ? ' is-over' : ''}`}
      aria-label={`${label} (${cards.length} cards)`}
    >
      <span className="playtest-pile__label">{label}</span>
      <div className="playtest-pile__stack">
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
          <div className={`playtest-pile__back playtest-pile__back--${zone}`} />
        )}
      </div>
      <span className="playtest-pile__count">{cards.length}</span>
    </button>
  );
}
