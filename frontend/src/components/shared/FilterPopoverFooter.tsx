import { Button } from '@/components/shared/Button';

/**
 * The footer every live filter popover ends on (STYLE_GUIDE § Filter kit): a
 * result count that updates as you tap, and "Clear filters" once anything is
 * on. The count is `aria-live` so a screen reader hears the list change.
 */
export function FilterPopoverFooter({
  resultLabel,
  onClear,
}: {
  /** "14 decks". Omit when the surface cannot say yet (still loading). */
  resultLabel?: string;
  /** Present only while a filter is on. */
  onClear?: () => void;
}) {
  if (resultLabel === undefined && !onClear) return null;
  return (
    <div className="deck-filters-footer">
      <span className="deck-filters-count" aria-live="polite">
        {resultLabel}
      </span>
      {onClear && (
        <Button variant="link" onClick={onClear} className="deck-filters-clear">
          Clear filters
        </Button>
      )}
    </div>
  );
}
