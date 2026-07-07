import { AlignJustify, LayoutGrid, List } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import './SearchPage.css';
import { SearchPill } from '../components/SearchPill';
import { InlineCardSearch, type InlineCardSearchView } from '../components/InlineCardSearch';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useStoredView } from '../lib/use-stored-view';

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
 * only owns the input, the layout toggle, and the landing state.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [view, setView] = useStoredView<InlineCardSearchView>(
    'mtg-search-view-mode',
    ['grid', 'list', 'compact'],
    'grid'
  );
  return (
    <div className={`search-page${view === 'grid' ? ' search-page--grid' : ''}`}>
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
        <>
          <div className="search-page-toolbar">
            <ViewModeToggle<InlineCardSearchView>
              ariaLabel="Result layout"
              value={view}
              onChange={setView}
              options={[
                {
                  value: 'grid',
                  label: 'Grid view',
                  icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
                },
                {
                  value: 'list',
                  label: 'List view (with thumbnails)',
                  icon: <List width={14} height={14} strokeWidth={2} aria-hidden />,
                },
                {
                  value: 'compact',
                  label: 'Compact list (text only)',
                  icon: <AlignJustify width={14} height={14} strokeWidth={2} aria-hidden />,
                },
              ]}
            />
          </div>
          <InlineCardSearch query={query} view={view} />
        </>
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
