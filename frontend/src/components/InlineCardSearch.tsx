import { forwardRef } from 'react';
import { useSearchCards } from '../lib/use-search-cards';
import {
  CardSearchResults,
  type CardSearchResultsHandle,
  type CardSearchResultsView,
} from './CardSearchResults';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';

/** Result layouts: `list` (thumbnail rows — the default everywhere this panel
 *  is embedded), `grid` (card-image tiles, preview-first), `compact`
 *  (text-only rows). Grid/compact are offered by the standalone /search page. */
export type InlineCardSearchView = CardSearchResultsView;

interface Props {
  /** The shared collection search term — this panel never owns an input. */
  query: string;
  /** Result layout. Defaults to the thumbnail-row list. */
  view?: InlineCardSearchView;
  /** When provided, a Hide control is shown that calls this. */
  onClose?: () => void;
  /**
   * Add action. Defaults to adding the card to the collection
   * (`store.addCard`). Pass to retarget the same results UI elsewhere — e.g.
   * the list view adds a list entry instead. Receives the chosen printing and
   * finish (finish omitted on a plain quick-add → the result's default).
   * Retargeted adds hide the collection-only extras (quantity/condition/
   * language pickers and the remove-last-added undo).
   */
  onAdd?: (card: ScryfallCard, finish?: Finish) => Promise<void> | void;
  /**
   * Fired after ANY successful add — quick-add or a specific printing —
   * regardless of whether `onAdd` was passed. Doesn't replace the default
   * collection-add behavior (`onAdd` does that); it's a side-channel for a
   * host that needs to react to "a card just landed" without owning the add
   * itself, e.g. the import-review unresolved-name repair row collapsing
   * once its search produces a match.
   */
  onAdded?: (card: ScryfallCard, finish?: Finish) => void;
  /** Pass-through to {@link CardSearchResults} — see its own doc comment. */
  onActiveChange?: (card: ScryfallCard | null) => void;
}

const RESULT_LIMIT = 60;
const PAGE_SIZE = 10;

/**
 * Live Scryfall search-and-add results panel, driven entirely by the
 * collection's own search bar (no second input — typing up top updates
 * these results). The trigger that opens it lives in the grid/list as
 * the trailing card/row. The row, its add/undo/toast behavior and the
 * preview carousel all live in {@link CardSearchResults}, shared with
 * {@link AddCardSearchPanel} so this panel and the Add-cards sheet can't
 * drift apart.
 *
 * Renders no input of its own — a host with one on screen (SearchPage,
 * ListAddCardSheet, ListDetailView's Scryfall panel, the import review's
 * unresolved-name repair row, ...) drives keyboard navigation through the
 * forwarded ref (`moveActive` / `addActive`) and `onActiveChange`, typically
 * via the shared `useResultsKeys` hook. TagsPage's own search box queries
 * tags, not these card results, so it leaves the ref unwired.
 */
export const InlineCardSearch = forwardRef<CardSearchResultsHandle, Props>(
  function InlineCardSearch(
    { query, view = 'list', onClose, onAdd, onAdded, onActiveChange },
    ref
  ) {
    const q = query.trim();
    const { results, loading, error, total } = useSearchCards(query, RESULT_LIMIT);

    return (
      <div className={`inline-card-search${view === 'grid' ? ' inline-card-search--grid' : ''}`}>
        <div className="inline-card-search-head">
          <span className="inline-card-search-head-title">Scryfall results for “{q}”</span>
          {onClose && (
            <button type="button" className="inline-card-search-hide" onClick={onClose}>
              Hide
            </button>
          )}
        </div>
        {q.length < 2 && (
          <p className="inline-card-search-status">Type at least two characters above.</p>
        )}
        {q.length >= 2 && loading && (
          <p className="inline-card-search-status">Searching Scryfall…</p>
        )}
        {error && <p className="inline-card-search-status inline-card-search-error">{error}</p>}
        {q.length >= 2 && !loading && !error && results.length === 0 && (
          <p className="inline-card-search-status">No cards on Scryfall match “{q}”.</p>
        )}
        <CardSearchResults
          ref={ref}
          results={results}
          view={view}
          pageSize={PAGE_SIZE}
          total={total}
          onAdd={onAdd}
          onAdded={onAdded}
          onActiveChange={onActiveChange}
        />
      </div>
    );
  }
);
