import type { Zone } from '@/lib/playtest';
import { CtxMenuShell } from './CtxMenuShell';

interface Props {
  x: number;
  y: number;
  cardName: string;
  variant: 'floating' | 'sheet';
  onClose(): void;
  /** Omitted (no item) when the card has no resolvable ScryfallCard. */
  onPreview?(): void;
  onPlay(opts?: { tapped?: boolean; faceDown?: boolean }): void;
  onMoveTo(zone: Zone, toIndex?: number): void;
  /** Whether the table is currently being shown this card. */
  revealed?: boolean;
  /** Show it to the table, or stop. Omitted off a table — there is nobody
   *  to show it to in a solo goldfish, and an item that does nothing is
   *  worse than no item. */
  onToggleReveal?(): void;
  /** Put it on the stack — casting it, in the only sense a
   *  manual-enforcement table means that word. */
  onPutOnStack?(copy: boolean): void;
}

/**
 * Right-click / long-press / Shift+Enter menu for a card in hand. A hand
 * card's whole vocabulary is here: the three ways to play it (face up,
 * tapped for a land that enters tapped, face down for morph/manifest), and
 * the moves out of hand a real game asks for constantly — discard, exile
 * (Chrome Mox, Force of Will pitch), back on top or bottom of the library
 * (Brainstorm, Ponder). A plain tap still plays the card.
 */
export function HandCardMenu({
  x,
  y,
  cardName,
  variant,
  onClose,
  onPreview,
  onPlay,
  onMoveTo,
  revealed = false,
  onToggleReveal,
  onPutOnStack,
}: Props) {
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <CtxMenuShell x={x} y={y} title={cardName} variant={variant} onClose={onClose}>
      {onPreview && (
        <button type="button" className="playtest-ctx-action" onClick={act(onPreview)}>
          Preview card
        </button>
      )}
      <button type="button" className="playtest-ctx-action" onClick={act(() => onPlay())}>
        Play
      </button>
      <button
        type="button"
        className="playtest-ctx-action"
        onClick={act(() => onPlay({ tapped: true }))}
      >
        Play tapped
      </button>
      <button
        type="button"
        className="playtest-ctx-action"
        onClick={act(() => onPlay({ faceDown: true }))}
      >
        Play face down
      </button>
      {onPutOnStack && (
        <button
          type="button"
          className="playtest-ctx-action"
          onClick={act(() => onPutOnStack(false))}
        >
          Put on the stack
        </button>
      )}
      {onToggleReveal && (
        <button
          type="button"
          className="playtest-ctx-action"
          onClick={act(onToggleReveal)}
          aria-pressed={revealed}
        >
          {revealed ? 'Stop showing it' : 'Show the table'}
        </button>
      )}
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Move to</div>
        <button
          type="button"
          className="playtest-ctx-action"
          onClick={act(() => onMoveTo('graveyard'))}
        >
          Discard
        </button>
        <button
          type="button"
          className="playtest-ctx-action"
          onClick={act(() => onMoveTo('exile'))}
        >
          Exile
        </button>
        <button
          type="button"
          className="playtest-ctx-action"
          onClick={act(() => onMoveTo('library', 0))}
        >
          Top of library
        </button>
        <button
          type="button"
          className="playtest-ctx-action"
          onClick={act(() => onMoveTo('library'))}
        >
          Bottom of library
        </button>
        <button
          type="button"
          className="playtest-ctx-action"
          onClick={act(() => onMoveTo('command'))}
        >
          Command zone
        </button>
      </div>
    </CtxMenuShell>
  );
}
