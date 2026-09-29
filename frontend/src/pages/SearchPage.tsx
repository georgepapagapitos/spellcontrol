import { Surface } from '../components/shared/Surface';
import { AlignJustify, HelpCircle, LayoutGrid, List } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import './SearchPage.css';
import { SearchPill } from '../components/SearchPill';
import { InlineCardSearch, type InlineCardSearchView } from '../components/InlineCardSearch';
import { BrowseRails } from '../components/browse/BrowseRails';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useCollapsedPref } from '@/lib/util/use-collapsed-pref';
import { useResultsKeys } from '@/lib/search/use-results-keys';
import { useStoredView } from '@/lib/util/use-stored-view';
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
 * only owns the input, the layout toggle, the syntax helper, and the landing.
 * With no query the landing is the browse rails ({@link BrowseRails}): top and
 * new commanders, top cards, Game Changers, salt and bans, each with a door to
 * its full list at `/search/top/:list`.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  // The box owns its own value; the URL is mirrored FROM it, never read back
  // into it. Rendering `params.get('q')` made the input only as fast as a
  // re-render: typed in a burst, React restored a stale param onto the DOM node
  // and ate every character typed in the gap — 19 in, 4 out at 0ms/key (E339).
  const [query, setQuery] = useState(urlQuery);
  // A foreign URL change — Back/Forward, or a link onto this same mount — still
  // has to reach the box, and the only thing separating one from our own mirror
  // write is that we know we asked for ours. `intent` is the URL we last asked
  // for; while the router is still catching up to it (`pending`), every value it
  // hands back is the echo of a keystroke, not a destination. Adjusted during
  // render — React's "resetting state when a prop changes" — so the box never
  // paints the stale query first.
  const [mirror, setMirror] = useState({ url: urlQuery, intent: urlQuery, pending: false });
  if (urlQuery !== mirror.url) {
    if (urlQuery === mirror.intent) setMirror({ url: urlQuery, intent: urlQuery, pending: false });
    else if (mirror.pending) setMirror({ ...mirror, url: urlQuery });
    else {
      setMirror({ url: urlQuery, intent: urlQuery, pending: false });
      setQuery(urlQuery);
    }
  }
  const commitQuery = (next: string) => {
    setQuery(next);
    setMirror((m) => ({ ...m, intent: next.trim() ? next : '', pending: true }));
    setParams(next.trim() ? { q: next } : {}, { replace: true });
  };
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
  // A lookup page, not an add flow — Enter out of habit right after typing
  // must not silently add the top hit (CardSearchResults starts active on
  // row 0), so this requires an explicit arrow press first.
  const {
    resultsRef,
    onActiveChange,
    onKeyDown: resultsKeyDown,
  } = useResultsKeys({
    enterNeedsNav: true,
    resetKey: query,
  });

  const insertExample = (snippet: string) => {
    const next = query.trim() ? `${query.replace(/\s+$/, '')} ${snippet}` : snippet;
    commitQuery(next);
    inputRef.current?.focus();
  };

  const searching = query.trim().length >= 2;
  // The landing's browse rails want the wide column the grid results use.
  const wide = !searching || view === 'grid';

  return (
    <div className={`search-page${wide ? ' search-page--wide' : ''}`}>
      <header className="search-page-head">
        <h1>Card search</h1>
        <p className="search-page-sub">
          Look up any card, owned or not.{' '}
          <Link className="search-page-tags-link text-link" to="/tags">
            Browse by tag
          </Link>{' '}
          if you know what a card does but not its name.
        </p>
      </header>
      <SearchPill
        ref={inputRef}
        className="search-page-pill"
        placeholder="Search Scryfall…"
        value={query}
        onChange={commitQuery}
        ariaLabel="Search any card"
        autoFocus={autoFocusSearch}
        inputProps={{ onKeyDown: resultsKeyDown }}
      />
      <div className="search-syntax">
        <button
          type="button"
          className="search-syntax-toggle"
          aria-expanded={!syntaxCollapsed}
          aria-controls="search-syntax-panel"
          onClick={() => setSyntaxCollapsed((v) => !v)}
        >
          <HelpCircle width={14} height={14} strokeWidth={1.8} aria-hidden />
          Search syntax
        </button>
        {!syntaxCollapsed && (
          <Surface
            as="div"
            variant="framed"
            className="search-syntax-panel"
            id="search-syntax-panel"
          >
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
              <code>otag:</code> searches Scryfall's functional card tags, such as{' '}
              <code>otag:repeatable-creature-tokens</code>.{' '}
              <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noopener noreferrer">
                Full syntax reference
              </a>
            </p>
          </Surface>
        )}
      </div>
      {searching ? (
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
                  icon: <LayoutGrid width={14} height={14} strokeWidth={1.8} aria-hidden />,
                },
                {
                  value: 'list',
                  label: 'List view (with thumbnails)',
                  icon: <List width={14} height={14} strokeWidth={1.8} aria-hidden />,
                },
                {
                  value: 'compact',
                  label: 'Compact list (text only)',
                  icon: <AlignJustify width={14} height={14} strokeWidth={1.8} aria-hidden />,
                },
              ]}
            />
          </div>
          <InlineCardSearch
            ref={resultsRef}
            query={query}
            view={view}
            onActiveChange={onActiveChange}
          />
        </>
      ) : (
        <BrowseRails />
      )}
    </div>
  );
}
