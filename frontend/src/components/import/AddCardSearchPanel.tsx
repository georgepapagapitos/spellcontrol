import { useState } from 'react';
import { SearchPill } from '@/components/search/SearchPill';
import { CardSearchResults } from '@/components/search/CardSearchResults';
import { useSearchCards } from '@/lib/search/use-search-cards';
import { useResultsKeys } from '@/lib/search/use-results-keys';
import type { ScryfallCard } from '@/deck-builder/types';

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
  /**
   * Retarget every add into the device-local Add list (T153) instead of the
   * collection — the unified Add-cards sheet's Search tab. The binder-pin
   * variant ({@link AddCardSheet}) always adds straight to the collection
   * and pins, so it leaves this off.
   */
  addToList?: boolean;
  /** Pass-through to {@link CardSearchResults} — see its own doc comment. */
  onActiveChange?: (card: ScryfallCard | null) => void;
  /** Pass-through to {@link CardSearchResults} — see its own doc comment. */
  hideRowDisclosure?: boolean;
}

/**
 * The reusable search-and-add body shared by {@link AddCardSheet} (the
 * binder-pin variant) and the unified add-cards modal's Search tab. Just the
 * input + results — no dialog chrome — so it composes inside any container.
 * The row itself, its add/undo/toast behavior and the preview carousel all
 * live in {@link CardSearchResults}, shared with {@link InlineCardSearch} so
 * the two surfaces can't drift apart again.
 */
export function AddCardSearchPanel({
  binderId,
  autoFocus = true,
  initialQuery,
  onEscape,
  addToList,
  onActiveChange,
  hideRowDisclosure,
}: Props) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const { results, loading, error } = useSearchCards(query);
  const { resultsRef, onActiveChange: trackActive, onKeyDown: navKeyDown } = useResultsKeys();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
        return;
      }
      onEscape?.();
      return;
    }
    navKeyDown(e);
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
        <CardSearchResults
          ref={resultsRef}
          results={results}
          binderId={binderId}
          addToList={addToList}
          onActiveChange={(card) => {
            trackActive(card);
            onActiveChange?.(card);
          }}
          hideRowDisclosure={hideRowDisclosure}
        />
      </div>
    </div>
  );
}
