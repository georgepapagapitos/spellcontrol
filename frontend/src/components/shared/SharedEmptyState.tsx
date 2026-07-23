import { EmptyStateMark } from './EmptyStateMark';

interface Props {
  /** True for "nothing here at all" (a genuinely empty binder/collection/
   *  deck/list/cube) — false for "your search/filters matched nothing".
   *  Same two-state shape every Shared*View's zero-result branch needs. */
  empty: boolean;
  /** e.g. "This binder is empty." */
  emptyTagline: string;
  /** Reason only, no CTA — `SharedShell`'s footer already carries "Plan your
   *  own binders & decks" right below every one of these views, so a second
   *  action button here would just repeat it. */
  emptyHint: string;
  /** e.g. "No cards match your search or filters." */
  filteredTagline: string;
  /** Clears the view's own search box (rendered as "Reset search" — see the
   *  button below for why it isn't labelled "Clear search"). Omit when the
   *  search box is already empty (the zero result came from filters alone)
   *  — a button that clears nothing is worse than no button; the filter
   *  popover already has its own Clear affordance one click away. */
  onClearSearch?: () => void;
}

/**
 * Shared zero-result state for every /s/:token and /d/:slug card list
 * (SharedBinderView, SharedCollectionView, SharedListView, SharedCubeView,
 * SharedDeckView) — replaces the bare `<p className="shared-empty">` each of
 * these hand-rolled, which skipped the app's two-part empty-state pattern
 * (tagline + hint, `EmptyStateMark` for a genuine primary empty — see
 * STYLE_GUIDE "Voice & copy" / "Empty states") and left a filtered-to-zero
 * search with no way back except manually clearing the search pill.
 */
export function SharedEmptyState({
  empty,
  emptyTagline,
  emptyHint,
  filteredTagline,
  onClearSearch,
}: Props) {
  if (empty) {
    return (
      <div className="empty-state">
        <EmptyStateMark />
        <p className="empty-state-tagline">{emptyTagline}</p>
        <p className="empty-state-hint">{emptyHint}</p>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <p className="empty-state-tagline">{filteredTagline}</p>
      {onClearSearch && (
        // "Reset search", not "Clear search" — the SearchPill above already
        // renders its own inline × with that exact accessible name whenever
        // the box has text, i.e. in every case this button can also show;
        // two on-page buttons sharing one name is a real a11y/cohesion smell
        // (caught by this component's own test), not just a naming nit.
        <button
          type="button"
          className="btn empty-state-action shared-empty-clear-btn"
          onClick={onClearSearch}
        >
          Reset search
        </button>
      )}
    </div>
  );
}
