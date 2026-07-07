import { useSearchParams } from 'react-router-dom';
import './SearchPage.css';
import { SearchPill } from '../components/SearchPill';
import { InlineCardSearch } from '../components/InlineCardSearch';

// Don't autofocus on touch — the soft keyboard would cover the landing copy
// the moment the page opens. Desktop (fine pointer, per the project's touch
// gate) still gets focus-on-open for typing.
const autoFocusSearch =
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * Standalone any-card lookup (`/search`) — search all of Scryfall to read a
 * card without owning it. The query lives in the URL (`?q=`) so a lookup is
 * shareable and survives back/forward. Results, owned-count badges, the
 * full-card preview carousel, and the add-a-copy action are all
 * {@link InlineCardSearch}, shared with the collection add flow — this page
 * only owns the input and the landing state.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  return (
    <div className="search-page">
      <header className="search-page-head">
        <h1>Card search</h1>
        <p className="search-page-sub">
          Look up any card — art, oracle text, rulings, printings, and prices. You don’t need to own
          it.
        </p>
      </header>
      <SearchPill
        className="search-page-pill"
        placeholder="Search Scryfall…"
        value={query}
        onChange={(next) => setParams(next.trim() ? { q: next } : {}, { replace: true })}
        ariaLabel="Search any card"
        autoFocus={autoFocusSearch}
      />
      {query.trim().length >= 2 ? (
        <InlineCardSearch query={query} />
      ) : (
        <div className="empty-state">
          <p className="empty-state-tagline">Every card, one search away.</p>
          <p className="empty-state-hint">
            Type a card name, or use Scryfall syntax like “t:dragon cmc&lt;4” or “o:landfall c:g”.
            Tap a result to read it; + adds a copy to your collection.
          </p>
        </div>
      )}
    </div>
  );
}
