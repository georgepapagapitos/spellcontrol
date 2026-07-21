import './CommanderTypeahead.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { SearchPill } from './SearchPill';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { searchCommanders } from '@/lib/discover-client';

interface Props {
  /** Currently selected commander filter, or null for "any". */
  value: string | null;
  onChange: (next: string | null) => void;
}

const DEBOUNCE_MS = 250;

/**
 * Server-backed commander-name combobox for the Discover filter toolbar.
 * Contract verified against the repo's real combobox precedent,
 * `SetFilterPicker.tsx` — `role="combobox"` input with `aria-autocomplete`,
 * `aria-expanded`, `aria-controls`, `aria-activedescendant` tracking a
 * highlighted option, a `role="listbox"` of `role="option"` results, Arrow
 * Up/Down/Enter/Escape handling — adapted for single-select: no chips,
 * picking a result sets the filter and clears the typed query (mirrors
 * `SetFilterPicker`'s own `addSet`). The current selection is surfaced via
 * the input's placeholder (empty query) plus a clear button, since there's
 * no chip to show it. Unlike SetFilterPicker, arrow keys WRAP at the list
 * ends, and a non-interactive "no match" row renders instead of nothing —
 * that row is deliberately excluded from `results` so it's never reachable
 * via arrow-key nav or `aria-activedescendant`.
 */
export function CommanderTypeahead({ value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const debouncedQuery = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  // '' means "nothing to fetch" — either closed, or no settled query yet.
  const fetchKey = open ? debouncedQuery : '';

  // Render-phase reset when the fetch key changes — the React-recommended
  // alternative to a synchronous setState at the top of an effect body
  // (react-hooks/set-state-in-effect flags that as cascading an extra
  // render); same "previous value" comparison idiom CommanderSearch.tsx's
  // `prevOwnedOnly` already uses in this codebase.
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey);
  if (prevFetchKey !== fetchKey) {
    setPrevFetchKey(fetchKey);
    if (fetchKey) setLoading(true);
    else {
      setResults([]);
      setLoading(false);
    }
  }

  // Fetch on settled query, only while the box is actually open (a prefilled
  // `value` never seeds `query`, so there's nothing to fetch on mount). Every
  // setState here lives inside the promise callbacks, not the effect body
  // itself, so react-hooks/set-state-in-effect has nothing to flag.
  useEffect(() => {
    if (!fetchKey) return;
    let cancelled = false;
    searchCommanders(fetchKey)
      .then((names) => {
        if (cancelled) return;
        setResults(names);
        setHighlight(0);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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

  const pick = (name: string) => {
    onChange(name);
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const clear = () => {
    onChange(null);
    setQuery('');
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
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      if (results.length === 0) return;
      e.preventDefault();
      pick(results[Math.min(highlight, results.length - 1)]);
    } else if (e.key === 'Escape') {
      // Closes the listbox only — a prior selection (`value`) is untouched,
      // and any in-progress typed text stays in the input.
      setOpen(false);
    }
  };

  const showListbox = open && debouncedQuery.length > 0;

  return (
    <div className="commander-typeahead" ref={wrapperRef}>
      <SearchPill
        ref={inputRef}
        inputType="text"
        value={query}
        onChange={(next) => {
          setQuery(next);
          setOpen(true);
        }}
        placeholder={value ?? 'Search commanders…'}
        ariaLabel="Filter by commander"
        hideClear
        trailing={
          value && (
            <button
              type="button"
              className="search-pill-clear"
              onClick={clear}
              aria-label="Clear commander filter"
              title="Clear commander filter"
            >
              ×
            </button>
          )
        }
        inputProps={{
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-expanded': showListbox,
          'aria-controls': listboxId,
          'aria-activedescendant':
            showListbox && results.length > 0
              ? `${listboxId}-option-${Math.min(highlight, results.length - 1)}`
              : undefined,
          onFocus: () => setOpen(true),
          onKeyDown,
        }}
      />
      {showListbox && (
        <ul id={listboxId} className="commander-typeahead-results" role="listbox">
          {loading ? (
            <li className="commander-typeahead-status" aria-disabled="true">
              <span className="spinner" aria-hidden="true" /> Searching…
            </li>
          ) : results.length === 0 ? (
            <li className="commander-typeahead-status" aria-disabled="true">
              No commanders match &quot;{debouncedQuery}&quot;
            </li>
          ) : (
            results.map((name, i) => (
              <li
                key={name}
                id={`${listboxId}-option-${i}`}
                role="option"
                aria-selected={i === highlight}
                className={`commander-typeahead-option${i === highlight ? ' is-highlight' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(name);
                }}
              >
                {name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
