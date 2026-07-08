import { AlignJustify, HelpCircle, LayoutGrid, List } from 'lucide-react';
import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import './SearchPage.css';
import { SearchPill } from '../components/SearchPill';
import { InlineCardSearch, type InlineCardSearchView } from '../components/InlineCardSearch';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useCollapsedPref } from '../lib/use-collapsed-pref';
import { useStoredView } from '../lib/use-stored-view';
import { offlineDataAvailable, useOfflineStore } from '../store/offline';

// Don't autofocus on touch — the soft keyboard would cover the landing copy
// the moment the page opens. Desktop (fine pointer, per the project's touch
// gate) still gets focus-on-open for typing.
const autoFocusSearch =
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

interface SyntaxEntry {
  /** Tappable snippet, appended to the query on click. */
  example: string;
  /** One-line description shown next to the example. */
  label: string;
  /** The offline query interpreter can't evaluate this operator — flagged
   *  with an "online" note when the offline bundle is serving searches. */
  onlineOnly?: boolean;
}

// ~10 core operators. `onlineOnly` mirrors the offline parser's subset
// (lib/offline/scryfall-query.ts: t, o, c, id, cmc/mv, f, is, keyword, banned,
// OR — note `keyword:` spelled out; the `kw:` shorthand is online-only);
// id<=esper is flagged because the offline parser only reads WUBRG letters,
// not named identities.
const SYNTAX_ENTRIES: SyntaxEntry[] = [
  { example: 't:dragon', label: 'Card type' },
  { example: 'o:"draw a card"', label: 'Oracle (rules) text' },
  { example: 'c<=ur', label: 'Colors within blue/red' },
  { example: 'id<=esper', label: 'Fits a commander color identity', onlineOnly: true },
  { example: 'mv>=6', label: 'Mana value (cmc<4 works too)' },
  { example: 'f:commander', label: 'Legal in a format' },
  { example: 'r:mythic', label: 'Rarity', onlineOnly: true },
  { example: 'pow>=5', label: 'Power', onlineOnly: true },
  { example: 'is:commander', label: 'Can be your commander' },
  { example: 'otag:removal', label: 'Function tag', onlineOnly: true },
  { example: '-t:land', label: 'Negate any term' },
  { example: 't:elf OR t:goblin', label: 'Match either side' },
];

/**
 * Standalone any-card lookup (`/search`) — search all of Scryfall to read a
 * card without owning it. The query lives in the URL (`?q=`) so a lookup is
 * shareable and survives back/forward. Results, owned-count badges, the
 * full-card preview carousel, and the add-a-copy action are all
 * {@link InlineCardSearch}, shared with the collection add flow — this page
 * only owns the input, the layout toggle, the syntax helper, and the landing
 * state.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [view, setView] = useStoredView<InlineCardSearchView>(
    'mtg-search-view-mode',
    ['grid', 'list', 'compact'],
    'grid'
  );
  const [syntaxCollapsed, setSyntaxCollapsed] = useCollapsedPref('mtg-search-syntax-collapsed');
  // Offline bundle present → searches are served by the local interpreter,
  // which only understands a subset of operators; surface the "online" notes.
  const offlineActive = useOfflineStore(offlineDataAvailable);
  const inputRef = useRef<HTMLInputElement>(null);

  const insertExample = (snippet: string) => {
    const next = query.trim() ? `${query.replace(/\s+$/, '')} ${snippet}` : snippet;
    setParams({ q: next }, { replace: true });
    inputRef.current?.focus();
  };

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
        ref={inputRef}
        className="search-page-pill"
        placeholder="Search Scryfall…"
        value={query}
        onChange={(next) => setParams(next.trim() ? { q: next } : {}, { replace: true })}
        ariaLabel="Search any card"
        autoFocus={autoFocusSearch}
      />
      <div className="search-syntax">
        <button
          type="button"
          className="search-syntax-toggle"
          aria-expanded={!syntaxCollapsed}
          aria-controls="search-syntax-panel"
          onClick={() => setSyntaxCollapsed((v) => !v)}
        >
          <HelpCircle width={13} height={13} strokeWidth={2} aria-hidden />
          Search syntax
        </button>
        {!syntaxCollapsed && (
          <div className="search-syntax-panel" id="search-syntax-panel">
            <ul className="search-syntax-list" role="list">
              {SYNTAX_ENTRIES.map((entry) => (
                <li key={entry.example} className="search-syntax-row">
                  <button
                    type="button"
                    className="search-syntax-example"
                    onClick={() => insertExample(entry.example)}
                    aria-label={`Insert ${entry.example} into the search`}
                  >
                    <code>{entry.example}</code>
                  </button>
                  <span className="search-syntax-desc">
                    {entry.label}
                    {entry.onlineOnly && offlineActive && (
                      <span className="search-syntax-online">online</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="search-syntax-note">
              <code>otag:</code> searches Scryfall’s community-curated functional categories, e.g.{' '}
              <code>otag:repeatable-creature-tokens</code>.{' '}
              <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noopener noreferrer">
                Full syntax reference
              </a>
            </p>
          </div>
        )}
      </div>
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
