import { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { useLongPress } from '@/lib/use-long-press';
import { TaxCoins } from './TaxCoins';

/** How many command-zone cards the corner row draws. Two, because that is a
 *  commander and a partner — the zone may hold any number. */
const COMMAND_ROW_MAX = 2;

/**
 * Pick a pile's card up and put it somewhere else: the battlefield, the hand,
 * another pile. The draggable id is `zone:<cardId>`, which PlaytestBoard's
 * drop handler routes the same way it routes a hand card. dnd-kit itself
 * swallows the click that ends a drag, so a card dropped back on its own pile
 * neither draws nor opens the viewer.
 *
 * Pointer only. dnd-kit's keyboard sensor would take Enter and Space for a
 * drag, and on a pile those keys are the tile's own click (draw, open the
 * viewer, open a commander's menu). The keyboard reaches every move a drag
 * makes through that viewer and those menus.
 */
function usePileDrag(zone: Zone, card: PlaytestCard | undefined) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    // An empty pile still calls the hook, and ids must stay unique per pile.
    id: `zone:${card?.id ?? `empty-${zone}`}`,
    data: { cardId: card?.id },
    disabled: !card,
  });
  // The listener map is typed as bare `Function`s; this gives the one used a
  // handler type.
  const onPointerDown = (e: React.PointerEvent) => listeners?.onPointerDown?.(e);
  return { setNodeRef, isDragging, onPointerDown };
}

interface Props {
  zone: Zone;
  label: string;
  cards: PlaytestCard[];
  /** Only meaningful for the command zone — omit elsewhere. */
  commanderTax?: Record<string, number>;
  /**
   * The commanders whose tax rides above the command zone as coins, EDHPlay's
   * way: gold for the commander, silver for a partner. A click adds a cast
   * (+2), a right-click, the Context Menu key or a long-press takes one off.
   * The coins stay while a commander is on the battlefield, which is when the
   * tax matters. Command zone only (see `taxCommanders`).
   */
  taxCards?: PlaytestCard[];
  onAdjustTax?(cardId: string, delta: 1 | -1): void;
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
   * Menu key and a finger's long-press all route here, so there is one menu
   * with one list of items rather than a popover for the pointer and a
   * different panel for everyone else.
   */
  onMenu(x: number, y: number): void;
  /**
   * Show the card on top face up instead of a card back — the library while
   * it is being played with the top revealed. Only the library has a back to
   * replace; every other pile already shows its top card.
   */
  revealTop?: boolean;
  /** Opens one commander's own card menu, where Move to ▸ Battlefield casts
   *  it. A click,
   *  a right-click or a long-press on a commander reaches it; anywhere else
   *  on the tile is the zone's menu. With partners there are two commanders
   *  sitting there at once, each with its OWN tax, so the menu is per card. */
  onCardMenu?(card: PlaytestCard, x: number, y: number): void;
}

export function ZonePile({
  zone,
  label,
  cards,
  commanderTax,
  taxCards = [],
  onAdjustTax,
  click,
  onMenu,
  revealTop = false,
  onCardMenu,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone}` });
  // A finger has no right-click, so the press-and-hold is the touch half of
  // the same gesture — opening the same menu at the same point. It replaces
  // the kebab the tile used to wear: a pile IS the control, and a button
  // parked on top of a card is chrome the table does not have.
  const longPress = useLongPress({
    onLongPress: (x, y) => {
      // A hold on one commander is that card's menu, as a right-click is.
      // (A hold on a tax coin never reaches here: TaxCoins keeps its touches.)
      const id = document
        .elementFromPoint(x, y)
        ?.closest('.playtest-pile__commander')
        ?.getAttribute('data-card-id');
      const card = id ? cards.find((c) => c.id === id) : undefined;
      if (card && onCardMenu) onCardMenu(card, x, y);
      else onMenu(x, y);
    },
  });
  // Which end is "top" differs by zone: the library is drawn from index 0,
  // while a discard pile's top is the card put there last.
  const top = zone === 'library' ? cards[0] : cards[cards.length - 1];
  // The command zone's commanders are drag sources of their own (see
  // CommanderTile), so the tile itself lifts nothing there.
  const {
    setNodeRef: setDragRef,
    isDragging,
    onPointerDown,
  } = usePileDrag(zone, zone === 'command' ? undefined : top);
  // While its top card is in the player's hand, the pile shows what is under
  // it, as a real pile does the moment you lift a card off it.
  const shown = isDragging ? (zone === 'library' ? cards[1] : cards.at(-2)) : top;
  // Tracks the id of a card whose image failed, so a new top card (the pile
  // shuffles/draws constantly) always gets a fresh chance to load.
  const [erroredId, setErroredId] = useState<string | null>(null);
  // The library is the only pile with something to hide, and only while it
  // is not being revealed. Everything else is a face-up pile by definition.
  const faceUp = Boolean(shown) && (zone !== 'library' || revealTop);
  // An empty command zone stays a plain empty well — there is nothing to lay
  // out, and the row would just be a labelled gap.
  const isCommandRow = zone === 'command' && cards.length > 0;
  return (
    <div
      ref={setNodeRef}
      className={`playtest-pile${isOver ? ' is-over' : ''}${shown ? '' : ' is-empty'}`}
      // Fires for the Context Menu key and Shift+F10 as well as a right-click,
      // and bubbles from whichever child has focus — so the keyboard reaches
      // the same menu without the tile needing a key handler of its own.
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      // Touch's half of the same gesture. On the tile root, so the hold
      // works anywhere on the pile — the card, its label, the empty well.
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
    >
      {zone === 'command' && onAdjustTax && (
        <TaxCoins
          cards={taxCards}
          commanderTax={commanderTax ?? {}}
          onAdjust={onAdjustTax}
          placement="pile"
        />
      )}
      {/* The command zone is a row of commanders, not a pile with a top card:
          partners put two there at once, each with its own tax, and either
          may be the one you are casting. Every other zone keeps the single
          stack, where "the top card" is a real and sufficient answer.

          The row shows the two most recent and no more. The zone itself
          holds whatever was put there — nothing stops you dragging ten
          lands in, and nothing should: this is a table, not a rules engine.
          But a row that grew with the zone would push the corner across the
          felt, so the count tells the truth (it says ten) and the viewer is
          where the rest live. */}
      {isCommandRow ? (
        <div className="playtest-pile__open playtest-pile__open--row">
          <span className="playtest-pile__label">
            {label} <span className="playtest-pile__count">({cards.length})</span>
          </span>
          <span className="playtest-pile__commanders">
            {cards.slice(-COMMAND_ROW_MAX).map((c) => (
              <CommanderTile
                key={c.id}
                card={c}
                imageFailed={c.id === erroredId}
                onImageError={() => setErroredId(c.id)}
                onContextMenu={(e) => {
                  if (!onCardMenu) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onCardMenu(c, e.clientX, e.clientY);
                }}
                onClick={(e) => {
                  // Same suppression as the pile's own button: a hold that
                  // opened the menu must not open it a second time.
                  if (longPress.consumedClick()) return;
                  // From the card's top edge, so the menu opens beside the
                  // commander whether a mouse or the keyboard pressed it.
                  const r = e.currentTarget.getBoundingClientRect();
                  onCardMenu?.(c, r.left + r.width / 2, r.top);
                }}
              />
            ))}
          </span>
        </div>
      ) : (
        <button
          ref={setDragRef}
          type="button"
          onPointerDown={onPointerDown}
          onClick={() => {
            // The menu already handled this press; without this the release
            // would ALSO draw a card or open the viewer behind it.
            if (longPress.consumedClick()) return;
            click.onClick();
          }}
          disabled={click.disabled}
          className="playtest-pile__open"
          aria-label={`${click.label}. ${label}, ${cards.length} cards`}
        >
          {/* The count rides in the label, so each tile is one line of text over
            its art and four of them fit a bottom-right corner row. */}
          <span className="playtest-pile__label">
            {label} <span className="playtest-pile__count">({cards.length})</span>
          </span>
          <span className="playtest-pile__stack">
            {faceUp && shown?.imageUrl && shown.id !== erroredId ? (
              <img
                src={shown.imageUrl}
                alt={shown.name}
                draggable={false}
                loading="lazy"
                decoding="async"
                onError={() => setErroredId(shown.id)}
              />
            ) : faceUp && shown ? (
              // A card whose art is missing or slow is still a card the player
              // is entitled to read — the same text placeholder a card face
              // degrades to, never a card back, which would say "hidden".
              <span className="playtest-card__placeholder">{shown.name}</span>
            ) : (
              <span className={`playtest-pile__back playtest-pile__back--${zone}`} />
            )}
          </span>
        </button>
      )}
    </div>
  );
}

/** One commander in the command zone's row. Its own component because each
 *  commander is its own drag source, and a hook cannot be called per item of
 *  a map. A click opens its menu (casting is in there); a drag puts it wherever it
 *  is dropped, the battlefield included, where the reducer bumps its tax. */
function CommanderTile({
  card,
  imageFailed,
  onImageError,
  onClick,
  onContextMenu,
}: {
  card: PlaytestCard;
  imageFailed: boolean;
  onImageError(): void;
  onClick(e: React.MouseEvent<HTMLButtonElement>): void;
  onContextMenu(e: React.MouseEvent): void;
}) {
  const { setNodeRef, isDragging, onPointerDown } = usePileDrag('command', card);
  return (
    <button
      ref={setNodeRef}
      type="button"
      className="playtest-pile__commander"
      // The card under the pointer for the per-card keys (A, H, K…), and the
      // art the hover preview enlarges.
      data-card-id={card.id}
      data-preview-id={card.imageUrl ? card.id : undefined}
      aria-haspopup="menu"
      aria-label={card.name}
      // Transparent, not removed, while it rides the pointer: the row keeps
      // its shape and dnd-kit keeps a node to measure.
      style={isDragging ? { opacity: 0 } : undefined}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onClick={onClick}
    >
      <span className="playtest-pile__stack">
        {card.imageUrl && !imageFailed ? (
          <img
            src={card.imageUrl}
            alt={card.name}
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={onImageError}
          />
        ) : (
          <span className="playtest-card__placeholder">{card.name}</span>
        )}
      </span>
    </button>
  );
}
