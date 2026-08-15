import { ListFilter } from 'lucide-react';
import type { Ref } from 'react';

interface Props {
  ref: Ref<HTMLButtonElement>;
  open: boolean;
  onClick: () => void;
  /** How many filters are currently narrowing the results. 0 hides the badge. */
  activeCount: number;
  /** Base name for the control, e.g. "Filters" or "Binder options". */
  label: string;
}

/**
 * The funnel-icon trigger that tucks into a `<SearchPill>`'s trailing slot,
 * with a count badge for how many filters are on.
 *
 * Shared by every filter popover so the affordance is identical across pages.
 * The four copies this replaced had already drifted apart in the one place it
 * matters least visibly and most for screen readers: the active-count suffix
 * was "(2 active)" on decks and combos but ", 2 active" on discover.
 */
export function FilterTrigger({ ref, open, onClick, activeCount, label }: Props) {
  return (
    <button
      ref={ref}
      type="button"
      className="filter-popover-btn"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={activeCount > 0 ? `${label} (${activeCount} active)` : label}
      title={label}
      onClick={onClick}
    >
      <ListFilter width={16} height={16} strokeWidth={2} aria-hidden />
      {activeCount > 0 && (
        <span className="collection-filters-badge" aria-hidden>
          {activeCount}
        </span>
      )}
    </button>
  );
}
