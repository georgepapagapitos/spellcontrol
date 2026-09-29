import { useState, type CSSProperties } from 'react';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { UNCATEGORIZED_LADDER_ID, type LadderEntry } from '@/lib/binder/binder-counts';
import { Button } from '@/components/shared/Button';
import './BinderLadder.css';

interface Props {
  ladder: LadderEntry[];
  draftId: string;
  /** How many of the draft's matches a binder above already claimed. */
  caughtAbove: number;
  /** "Commanders", "Commanders and Rares", "Commanders and 3 others". */
  caughtByLabel: string;
  /** The binder "Move above" re-seats the draft ahead of; null when there's
   *  nothing to move above (shouldn't happen alongside caughtAbove > 0, but
   *  the button is omitted rather than thrown on). */
  onMoveAbove: (() => void) | null;
  moveAboveLabel: string;
  /** True exactly when the binder's rules currently land nothing (matches > 0,
   *  lands === 0, no pending Move-above) — the same condition the editor used
   *  to show as a SEPARATE amber banner. The caught-by line already explains
   *  why and carries the fix, so that state is folded in here instead of
   *  duplicating a second "Move above" box with the same action. */
  isEmpty?: boolean;
}

/** Phone shows only the binder immediately above the draft (positionally —
 *  not necessarily the one that caught its cards, which the dim line below
 *  names explicitly), the draft, and the one immediately below. */
function neighboursOf<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => Math.abs(i - index) <= 1);
}

/**
 * "A card goes to the first binder that wants it" — the waterfall order, this
 * binder highlighted, with the same counts the footer's "N land here" reads
 * (`countEffectiveLanding`), so the two can never disagree.
 */
export function BinderLadder({
  ladder,
  draftId,
  caughtAbove,
  caughtByLabel,
  onMoveAbove,
  moveAboveLabel,
  isEmpty = false,
}: Props) {
  const phone = useMediaQuery('(max-width: 599px)');
  const [expanded, setExpanded] = useState(false);
  const draftIndex = ladder.findIndex((e) => e.id === draftId);
  const showAll = !phone || expanded || draftIndex === -1;
  const visible = showAll ? ladder : neighboursOf(ladder, draftIndex);

  const ordinals = new Map<string, number>();
  let n = 0;
  for (const entry of ladder) {
    if (entry.id !== UNCATEGORIZED_LADDER_ID) {
      n += 1;
      ordinals.set(entry.id, n);
    }
  }

  return (
    <div className="binder-ladder">
      <p className="binder-ladder-lede">A card goes to the first binder that wants it:</p>
      <ul className="binder-ladder-list">
        {visible.map((entry) => {
          const isUncategorized = entry.id === UNCATEGORIZED_LADDER_ID;
          return (
            <li key={entry.id} className={`binder-ladder-rung${entry.isDraft ? ' is-me' : ''}`}>
              <span className="binder-ladder-ord" aria-hidden="true">
                {isUncategorized ? '' : ordinals.get(entry.id)}
              </span>
              <span
                className={`binder-ladder-swatch${isUncategorized ? ' is-uncategorized' : ''}`}
                style={
                  entry.color ? ({ '--swatch-color': entry.color } as CSSProperties) : undefined
                }
                aria-hidden="true"
              />
              <span className="binder-ladder-name">
                {entry.isDraft ? 'This binder' : entry.name || 'Untitled binder'}
              </span>
              <span className="binder-ladder-count">{entry.count.toLocaleString()}</span>
            </li>
          );
        })}
      </ul>
      {caughtAbove > 0 && (
        <p className={`binder-ladder-caught${isEmpty ? ' is-warning' : ''}`}>
          <span className="binder-ladder-caught-text">
            {caughtAbove.toLocaleString()} of its matches went to {caughtByLabel}, above.
            {onMoveAbove && (
              <Button variant={isEmpty ? undefined : 'link'} onClick={onMoveAbove}>
                {moveAboveLabel}
              </Button>
            )}
          </span>
        </p>
      )}
      {phone && !showAll && (
        <Button variant="link" className="binder-ladder-show-all" onClick={() => setExpanded(true)}>
          Show all binders
        </Button>
      )}
    </div>
  );
}
