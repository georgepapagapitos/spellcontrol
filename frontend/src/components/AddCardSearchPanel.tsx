import { useRef, useState } from 'react';
import { SearchPill } from './SearchPill';
import { CardSearchResults, type CardSearchResultsHandle } from './CardSearchResults';
import { useSearchCards } from '../lib/use-search-cards';

interface Props {
  /** When provided, the card is also pinned to this binder after being added. */
  binderId?: string;
  /** Focus the search input on mount. Default true. */
  autoFocus?: boolean;
  /** Seeds the query on mount — the collection-search hand-off (T153). */
  initialQuery?: string;
  /** Escape behavior: clear the query, then bubble up to the caller. The caller
   *  decides what bubbling means (close the dialog, switch tab, etc.). */
  onEscape?: () => void;
}

/**
 * The reusable search-and-add body shared by {@link AddCardSheet} (the
 * binder-pin variant) and the unified add-cards modal's Search tab. Just the
 * input + results — no dialog chrome — so it composes inside any container.
 * The row itself, its add/undo/toast behavior and the preview carousel all
 * live in {@link CardSearchResults}, shared with {@link InlineCardSearch} so
 * the two surfaces can't drift apart again.
 */
export function AddCardSearchPanel({ binderId, autoFocus = true, initialQuery, onEscape }: Props) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const { results, loading, error } = useSearchCards(query);
  const resultsRef = useRef<CardSearchResultsHandle>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
        return;
      }
      onEscape?.();
      return;
    }
    if (e.key === 'ArrowDown') {
      if (results.length === 0) return;
      e.preventDefault();
      resultsRef.current?.moveActive(1);
    } else if (e.key === 'ArrowUp') {
      if (results.length === 0) return;
      e.preventDefault();
      resultsRef.current?.moveActive(-1);
    } else if (e.key === 'Enter') {
      if (results.length === 0) return;
      e.preventDefault();
      resultsRef.current?.addActive();
    }
  };

  return (
    <div className="add-card-search-panel">
      <div className="add-card-search-input-wrap">
        <SearchPill
          placeholder="Search Scryfall…"
          value={query}
          onChange={setQuery}
          ariaLabel="Search Scryfall"
          autoFocus={autoFocus}
          inputProps={{ onKeyDown: handleKeyDown }}
        />
      </div>

      <div className="add-card-sheet-body">
        {query.trim().length < 2 && (
          <p className="card-picker-empty">Type at least two characters to search.</p>
        )}
        {loading && <p className="card-picker-empty">Searching…</p>}
        {error && <p className="card-picker-empty add-card-sheet-error">{error}</p>}
        {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
          <p className="card-picker-empty">No matches.</p>
        )}
        <CardSearchResults ref={resultsRef} results={results} binderId={binderId} />
      </div>
    </div>
  );
}
