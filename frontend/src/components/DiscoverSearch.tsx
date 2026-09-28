import './DiscoverSearch.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SearchPill } from './SearchPill';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { searchCommanders } from '@/lib/discover-client';

interface Props {
  /** The committed text search (`?q=`), or null for none. */
  query: string | null;
  onQueryChange: (next: string | null) => void;
  /** A commander suggestion was picked: filter to exactly that commander and
   *  drop the text search that found it, in one update. */
  onPickCommander: (name: string) => void;
  /** Docked inside the pill after the clear button (the filters popover),
   *  the same slot every other SearchPill surface puts its filter icon in. */
  trailing?: ReactNode;
}

const DEBOUNCE_MS = 250;

/**
 * The Discover search box. Typing filters the gallery live by deck name,
 * commander or builder (committed to `?q=` after a short pause), and a
 * listbox under it offers the published commanders that match, so a picked
 * one becomes an exact commander filter (shown as a chip by the page).
 *
 * Combobox contract follows `SetFilterPicker.tsx`: `role="combobox"` with
 * `aria-autocomplete`/`aria-expanded`/`aria-controls`/`aria-activedescendant`,
 * a `role="listbox"` of `role="option"` rows, Arrow Up/Down wrapping, Escape
 * closing. Nothing is highlighted until an arrow key moves into the list, so
 * Enter on its own searches the typed text instead of swapping it for
 * whichever commander happened to be first.
 */
export function DiscoverSearch({ query, onQueryChange, onPickCommander, trailing }: Props) {
  const [text, setText] = useState(query ?? '');
  // The last value this box pushed up. A `query` prop that differs from it
  // came from outside (Clear all, back/forward), so the box adopts it; one
  // that matches is our own commit echoing back and must not clobber
  // keystrokes typed since.
  const [committed, setCommitted] = useState(query);
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    if (query !== committed) {
      setCommitted(query);
      setText(query ?? '');
    }
  }

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [results, setResults] = useState<string[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commitTimer = useRef<number | undefined>(undefined);
  const listboxId = useId();

  const commit = (raw: string) => {
    window.clearTimeout(commitTimer.current);
    const next = raw.trim() || null;
    if (next === committed) return;
    setCommitted(next);
    onQueryChange(next);
  };
  useEffect(() => () => window.clearTimeout(commitTimer.current), []);

  const debouncedText = useDebouncedValue(text.trim(), DEBOUNCE_MS);
  // '' means "nothing to fetch": either closed, or no settled text yet.
  const fetchKey = open ? debouncedText : '';

  // Render-phase reset on a new fetch key, the React-recommended alternative
  // to a synchronous setState at the top of an effect body.
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey);
  if (prevFetchKey !== fetchKey) {
    setPrevFetchKey(fetchKey);
    setHighlight(-1);
    if (!fetchKey) setResults([]);
  }

  // Every setState lives in the promise callbacks, not the effect body, so
  // react-hooks/set-state-in-effect has nothing to flag. A failed lookup only
  // means no suggestions; the text search itself still runs.
  useEffect(() => {
    if (!fetchKey) return;
    let cancelled = false;
    searchCommanders(fetchKey)
      .then((names) => {
        if (!cancelled) setResults(names);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const showListbox = open && results.length > 0;
  const activeIndex = showListbox && highlight >= 0 ? Math.min(highlight, results.length - 1) : -1;

  const pick = (name: string) => {
    window.clearTimeout(commitTimer.current);
    setText('');
    setCommitted(null);
    setResults([]);
    setOpen(false);
    onPickCommander(name);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setHighlight((h) => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) pick(results[activeIndex]);
      else {
        commit(text);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      // Closes the listbox only; the typed search stays applied.
      setOpen(false);
    }
  };

  return (
    <div className="discover-search" ref={wrapperRef}>
      <SearchPill
        ref={inputRef}
        inputType="text"
        value={text}
        onChange={(next) => {
          setText(next);
          setOpen(true);
          window.clearTimeout(commitTimer.current);
          // A cleared box applies at once; typing waits for a pause.
          if (!next.trim()) commit('');
          else commitTimer.current = window.setTimeout(() => commit(next), DEBOUNCE_MS);
        }}
        placeholder="Search decks, commanders, builders…"
        ariaLabel="Search public decks"
        trailing={trailing}
        inputProps={{
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-expanded': showListbox,
          'aria-controls': listboxId,
          'aria-activedescendant':
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined,
          onFocus: () => setOpen(true),
          onKeyDown,
        }}
      />
      {showListbox && (
        <ul
          id={listboxId}
          className="discover-search-results"
          role="listbox"
          aria-label="Filter by commander"
        >
          <li className="discover-search-status" role="presentation">
            Filter by commander
          </li>
          {results.map((name, i) => (
            <li
              key={name}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`discover-search-option${i === activeIndex ? ' is-highlight' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(name);
              }}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
