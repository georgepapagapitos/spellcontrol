import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { MoreVertical } from 'lucide-react';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { commanderTaxAmount } from '../lib/zones';

/** How many command-zone cards the corner row draws. Two, because that is a
 *  commander and a partner — the zone may hold any number. */
const COMMAND_ROW_MAX = 2;

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
  /**
   * Show the card on top face up instead of a card back — the library while
   * it is being played with the top revealed. Only the library has a back to
   * replace; every other pile already shows its top card.
   */
  revealTop?: boolean;
  /**
   * Cast one specific card out of this pile. The command zone is the only
   * one that needs it: with partners there are two commanders sitting there
   * at once, each with its OWN tax, and a pile that renders a single top
   * card cannot say which one you meant. Absent elsewhere, where a pile is
   * a pile and the tile's own click is the whole interaction.
   */
  onCastCommander?(card: PlaytestCard): void;
}

export function ZonePile({
  zone,
  label,
  cards,
  commanderTax,
  click,
  onMenu,
  revealTop = false,
  onCastCommander,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone}` });
  // Which end is "top" differs by zone: the library is drawn from index 0,
  // while a discard pile's top is the card put there last.
  const top = zone === 'library' ? cards[0] : cards[cards.length - 1];
  // Tracks the id of a card whose image failed, so a new top card (the pile
  // shuffles/draws constantly) always gets a fresh chance to load.
  const [erroredId, setErroredId] = useState<string | null>(null);
  const tax = zone === 'command' ? commanderTaxAmount(commanderTax ?? {}, top?.id) : 0;
  // The library is the only pile with something to hide, and only while it
  // is not being revealed. Everything else is a face-up pile by definition.
  const faceUp = Boolean(top) && (zone !== 'library' || revealTop);
  // An empty command zone stays a plain empty well — there is nothing to lay
  // out, and the row would just be a labelled gap.
  const isCommandRow = zone === 'command' && cards.length > 0;
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
            {cards.slice(-COMMAND_ROW_MAX).map((c) => {
              const ctax = commanderTaxAmount(commanderTax ?? {}, c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="playtest-pile__commander"
                  onClick={() => onCastCommander?.(c)}
                  aria-label={`Cast ${c.name}${ctax > 0 ? `, tax +${ctax}` : ''}`}
                >
                  {/* Above the art, as the coin counters are — the tax is a
                      cost you read before deciding, not a footnote. */}
                  <span
                    className={`playtest-pile__tax playtest-pile__tax--own${
                      ctax > 0 ? '' : ' is-zero'
                    }`}
                    aria-hidden
                  >
                    +{ctax}
                  </span>
                  <span className="playtest-pile__stack">
                    {c.imageUrl && c.id !== erroredId ? (
                      <img
                        src={c.imageUrl}
                        alt={c.name}
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        onError={() => setErroredId(c.id)}
                      />
                    ) : (
                      <span className="playtest-card__placeholder">{c.name}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </span>
        </div>
      ) : (
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
            {label} <span className="playtest-pile__count">({cards.length})</span>
          </span>
          <span className="playtest-pile__stack">
            {faceUp && top?.imageUrl && top.id !== erroredId ? (
              <img
                src={top.imageUrl}
                alt={top.name}
                draggable={false}
                loading="lazy"
                decoding="async"
                onError={() => setErroredId(top.id)}
              />
            ) : faceUp && top ? (
              // A card whose art is missing or slow is still a card the player
              // is entitled to read — the same text placeholder a card face
              // degrades to, never a card back, which would say "hidden".
              <span className="playtest-card__placeholder">{top.name}</span>
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
      )}
    </div>
  );
}
