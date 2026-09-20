import './StackStrip.css';

export interface StackStripItem {
  id: string;
  name: string;
  isCopy: boolean;
  /** Seat that put it there — null in solo playtest. */
  seat: number | null;
  seatName?: string;
  /** Only your own entries carry the resolve/remove controls: you can't
   *  resolve somebody else's spell, at this table or a real one. */
  mine: boolean;
}

interface Props {
  items: readonly StackStripItem[];
  /** Resolve one of your entries — the top one first, which is why the list
   *  renders top-first and only the head gets the primary button. */
  onResolve(id: string): void;
  /** Take one of your entries off without resolving it: countered, fizzled,
   *  or put there by mistake. */
  onRemove(id: string): void;
}

/**
 * The stack, as a strip down the side of the table.
 *
 * Renders top-first, because the top is the only entry anybody is about to
 * act on. Your own entries carry the two controls; everyone else's are
 * there to be read — a manual-enforcement table resolves by agreement, and
 * the strip's job is to make sure all four players are looking at the same
 * list while they agree.
 *
 * ⚠️ Order is exact WITHIN a seat and grouped ACROSS seats. Each player's
 * client owns its own stack and there is no shared clock to interleave
 * them by, so the strip groups rather than inventing an order it can't
 * know. In practice one player is holding priority at a time and the group
 * they care about is their own.
 *
 * Renders nothing when the stack is empty — an empty stack is the normal
 * state of a table and a permanent "Stack (0)" panel would be chrome for
 * its own sake.
 */
export function StackStrip({ items, onResolve, onRemove }: Props) {
  if (items.length === 0) return null;
  const topMine = items.find((i) => i.mine)?.id;
  return (
    <aside className="stack-strip" aria-label="The stack">
      <h2 className="stack-strip__title">
        The stack
        <span className="stack-strip__count">{items.length}</span>
      </h2>
      <ol className="stack-strip__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`stack-strip__item${item.mine ? ' is-mine' : ''}${
              item.id === topMine ? ' is-next' : ''
            }`}
          >
            <div className="stack-strip__body">
              <span className="stack-strip__name">{item.name}</span>
              <span className="stack-strip__meta">
                {item.isCopy && <span className="stack-strip__copy">Copy</span>}
                {!item.mine && item.seatName && <span>{item.seatName}</span>}
              </span>
            </div>
            {item.mine && (
              <div className="stack-strip__actions">
                <button
                  type="button"
                  className="stack-strip__resolve"
                  onClick={() => onResolve(item.id)}
                >
                  Resolve
                </button>
                <button
                  type="button"
                  className="stack-strip__remove"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Take ${item.name} off the stack`}
                >
                  ✕
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
