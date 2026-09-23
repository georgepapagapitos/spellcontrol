import { ChevronUp } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { Hand } from './Hand';

/** A phone held sideways: every chrome row stacks above the hand and the
 *  battlefield gets whatever is left. Same query as the playtest.css block
 *  that restyles the board for it. */
export const SHORT_LANDSCAPE_QUERY = '(max-height: 420px) and (orientation: landscape)';

const CHIP_LIMIT = 4;

interface Props {
  cards: PlaytestCard[];
  open: boolean;
  onOpen(): void;
  onClose(): void;
  onCardMenu?(cardId: string, x: number, y: number): void;
  /** Cards currently shown to the table — passed straight through to the
   *  fan, which is what marks them. */
  revealedIds?: ReadonlySet<string>;
}

/**
 * Short-landscape replacement for the always-open hand strip (E264): a 44px
 * row with the count and the first few card names, which opens the real hand
 * as a sheet over the battlefield. Tapping a card opens its menu (playing it
 * from there closes the sheet); the strip stays a drop target so a permanent can still be dragged
 * back to hand while the sheet is closed.
 */
export function HandDrawer({ cards, open, onOpen, onClose, onCardMenu, revealedIds }: Props) {
  return open ? (
    <HandSheet cards={cards} onClose={onClose} onCardMenu={onCardMenu} revealedIds={revealedIds} />
  ) : (
    <HandStrip cards={cards} onOpen={onOpen} />
  );
}

function HandStrip({ cards, onOpen }: Pick<Props, 'cards' | 'onOpen'>) {
  const { setNodeRef, isOver } = useDroppable({ id: 'hand' });
  const extra = cards.length - CHIP_LIMIT;
  return (
    <div ref={setNodeRef} className={`playtest-hand-drawer${isOver ? ' is-over' : ''}`}>
      <button
        type="button"
        className="playtest-hand-drawer__toggle"
        onClick={onOpen}
        aria-expanded={false}
        aria-haspopup="dialog"
      >
        <span className="playtest-hand__label">Hand ({cards.length})</span>
        <span className="playtest-hand-drawer__chips">
          {cards.slice(0, CHIP_LIMIT).map((c) => (
            <span key={c.id} className="playtest-hand-drawer__chip">
              {c.name}
            </span>
          ))}
          {extra > 0 && (
            <span className="playtest-hand-drawer__chip playtest-hand-drawer__chip--more">
              +{extra}
            </span>
          )}
        </span>
        <ChevronUp className="playtest-hand-drawer__chevron" aria-hidden size={16} />
      </button>
    </div>
  );
}

function HandSheet({ cards, onClose, onCardMenu, revealedIds }: Omit<Props, 'open' | 'onOpen'>) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useEscapeKey(beginClose);
  return (
    <div className="card-picker-root" role="presentation">
      <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
      <div
        className={`card-picker-sheet playtest-hand-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-hand-sheet-title"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-header">
          <h2 id="playtest-hand-sheet-title" className="card-picker-title">
            Hand ({cards.length})
          </h2>
        </div>
        {cards.length === 0 ? (
          <p className="playtest-hand-sheet__empty">No cards in hand.</p>
        ) : (
          <Hand cards={cards} reorderable revealedIds={revealedIds} onCardMenu={onCardMenu} />
        )}
        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => beginClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
