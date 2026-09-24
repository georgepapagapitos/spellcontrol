import { useRef } from 'react';
import { Coins } from 'lucide-react';
import type { PlaytestCard } from '@/lib/playtest';
import { useLongPress } from '@/lib/use-long-press';
import { commanderTaxAmount } from '../lib/zones';

interface Props {
  /** Whose tax each coin tracks, gold first (see `taxCommanders`). */
  cards: PlaytestCard[];
  commanderTax: Record<string, number>;
  onAdjust(cardId: string, delta: 1 | -1): void;
  /** `pile` floats above the command pile's label on the table; `inline`
   *  sits in the phone's command tile header. */
  placement: 'pile' | 'inline';
}

/**
 * Commander tax, EDHPlay's way: a coin per commander, gold for the commander
 * and silver for a partner, with the tax beside it. A click adds a cast (+2);
 * a right-click, the Context Menu key or a long-press takes one off. One
 * component for the table's command pile and the phone's command tile, so
 * the two can never disagree about what a tap does.
 */
export function TaxCoins({ cards, commanderTax, onAdjust, placement }: Props) {
  // A finger has no right-click: holding a coin is the touch half of taking
  // a cast off. The coins' touches stop here, so the pile or tile around
  // them never also reads the hold as a press of its own.
  // The coin the finger came down on, kept from the touch start rather than
  // found under the point when the hold fires, so a finger that drifts a few
  // pixels still takes the cast off the coin it pressed.
  const pressed = useRef<string | null>(null);
  const longPress = useLongPress({
    onLongPress: () => {
      if (pressed.current) onAdjust(pressed.current, -1);
    },
  });
  if (cards.length === 0) return null;
  return (
    <div
      className={`playtest-tax-coins playtest-tax-coins--${placement}`}
      onTouchStart={(e) => {
        e.stopPropagation();
        pressed.current =
          (e.target as Element).closest('.playtest-tax-coin')?.getAttribute('data-tax-card-id') ??
          null;
        longPress.onTouchStart(e);
      }}
      onTouchMove={(e) => {
        e.stopPropagation();
        longPress.onTouchMove(e);
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        longPress.onTouchEnd(e);
      }}
      onTouchCancel={(e) => {
        e.stopPropagation();
        longPress.onTouchCancel(e);
      }}
    >
      {cards.map((c, i) => {
        const amount = commanderTaxAmount(commanderTax, c.id);
        return (
          <button
            key={c.id}
            type="button"
            className={`playtest-tax-coin${i > 0 ? ' playtest-tax-coin--partner' : ''}`}
            data-tax-card-id={c.id}
            // Hovering a coin shows whose it is, which is the question two
            // coins side by side raise.
            data-preview-id={c.imageUrl ? c.id : undefined}
            aria-label={`${c.name} commander tax, ${amount}`}
            title={`${c.name}: click to add 2, right-click to take 2 off`}
            onClick={() => {
              // The hold already took a cast off; its release is not a click.
              if (longPress.consumedClick()) return;
              onAdjust(c.id, 1);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAdjust(c.id, -1);
            }}
          >
            <Coins aria-hidden width={14} height={14} />
            {amount}
          </button>
        );
      })}
    </div>
  );
}
