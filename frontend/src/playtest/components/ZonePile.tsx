import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { MoreVertical } from 'lucide-react';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { commanderTaxAmount } from '../lib/zones';

interface Props {
  zone: Zone;
  label: string;
  cards: PlaytestCard[];
  /** Only meaningful for the command zone — omit elsewhere. */
  commanderTax?: Record<string, number>;
  /**
   * What a click on the tile does. The library draws, because that is the
   * action a player takes fifty times a game; every other pile opens its
   * viewer, because it has no one obvious action. `label` is a whole phrase
   * ("Draw a card", "View the graveyard") and is what a screen reader hears
   * before the zone and its count.
   */
  click: { label: string; onClick(): void; disabled?: boolean };
  /**
   * Opens this zone's menu at a point on screen. Right-click, the Context
   * Menu key and the tile's own kebab all route here, so there is one menu
   * with one list of items rather than a popover for the pointer and a
   * different panel for everyone else.
   */
  onMenu(x: number, y: number): void;
}

export function ZonePile({ zone, label, cards, commanderTax, click, onMenu }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone}` });
  const top = cards[cards.length - 1];
  // Tracks the id of a card whose image failed, so a new top card (the pile
  // shuffles/draws constantly) always gets a fresh chance to load.
  const [erroredId, setErroredId] = useState<string | null>(null);
  const tax = zone === 'command' ? commanderTaxAmount(commanderTax ?? {}, top?.id) : 0;
  return (
    <div
      ref={setNodeRef}
      className={`playtest-pile${isOver ? ' is-over' : ''}${cards.length === 0 ? ' is-empty' : ''}`}
      // Fires for the Context Menu key and Shift+F10 as well as a right-click,
      // and bubbles from whichever child has focus — so the keyboard reaches
      // the same menu without the tile needing a key handler of its own.
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      <button
        type="button"
        className="playtest-pile__kebab"
        aria-haspopup="menu"
        aria-label={`${label} actions`}
        onClick={(e) => {
          // Anchored under the kebab rather than at the pointer, so a click
          // and a keyboard activation put the menu in the same place.
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(r.left, r.bottom);
        }}
      >
        <MoreVertical width={16} height={16} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        onClick={click.onClick}
        disabled={click.disabled}
        className="playtest-pile__open"
        aria-label={`${click.label}. ${label}, ${cards.length} cards${
          tax > 0 ? `, tax +${tax}` : ''
        }`}
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
    </div>
  );
}
