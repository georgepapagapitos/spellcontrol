import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SetMap } from '../lib/api';

interface Props {
  setMap: SetMap | undefined;
  /** Uppercase set codes currently selected. */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}

const MAX_RESULTS = 40;

/**
 * Multi-select set picker — type to search Scryfall sets, click to add as a
 * chip, X to remove. Matches the existing chip filter pattern (rarity/binder
 * selects) but adds free-text search since the full Scryfall set list is too
 * long for a flat dropdown.
 */
export function SetFilterPicker({ setMap, value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const allSets = useMemo(() => {
    if (!setMap) return [];
    return Object.values(setMap).sort((a, b) =>
      (b.releasedAt || '').localeCompare(a.releasedAt || '')
    );
  }, [setMap]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allSets.filter((s) => {
      if (value.has(s.code.toUpperCase())) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
    });
    return filtered.slice(0, MAX_RESULTS);
  }, [allSets, query, value]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  const addSet = (code: string) => {
    const next = new Set(value);
    next.add(code.toUpperCase());
    onChange(next);
    setQuery('');
    setHighlight(0);
    inputRef.current?.focus();
  };

  const removeSet = (code: string) => {
    const next = new Set(value);
    next.delete(code.toUpperCase());
    onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      const pick = matches[highlight];
      if (pick) {
        e.preventDefault();
        addSet(pick.code);
      }
    } else if (e.key === 'Backspace' && query === '' && value.size > 0) {
      // Pop the most-recently-added chip when the input is empty.
      const last = [...value].pop();
      if (last) removeSet(last);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const selectedSummaries = useMemo(() => {
    if (!setMap) return [];
    // Preserve insertion order — chips stay where the user put them so newly
    // added ones append to the end rather than jumping alphabetically.
    return [...value].map(
      (code) => setMap[code] ?? { code, name: code, iconSvgUri: '', releasedAt: '' }
    );
  }, [setMap, value]);

  return (
    <div className="set-filter-picker" ref={wrapperRef}>
      <div className="set-filter-pill" onClick={() => inputRef.current?.focus()}>
        {selectedSummaries.map((s) => (
          <span key={s.code} className="set-filter-chip">
            {s.iconSvgUri && (
              <img src={s.iconSvgUri} alt="" aria-hidden className="set-filter-chip-icon" />
            )}
            <span className="set-filter-chip-label" title={s.name}>
              {s.code.toUpperCase()}
            </span>
            <button
              type="button"
              className="set-filter-chip-x"
              onClick={(e) => {
                e.stopPropagation();
                removeSet(s.code);
              }}
              aria-label={`Remove ${s.name}`}
              title={`Remove ${s.name}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.size === 0 ? 'Filter by set…' : ''}
          aria-label="Filter by set"
          aria-autocomplete="list"
          aria-expanded={open}
          role="combobox"
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="set-filter-results" role="listbox">
          {matches.map((s, i) => {
            const year = (s.releasedAt || '').slice(0, 4);
            return (
              <li
                key={s.code}
                role="option"
                aria-selected={i === highlight}
                className={`set-filter-result${i === highlight ? ' is-highlight' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addSet(s.code);
                }}
              >
                {s.iconSvgUri && (
                  <img src={s.iconSvgUri} alt="" aria-hidden className="set-filter-result-icon" />
                )}
                <span className="set-filter-result-name">{s.name}</span>
                <span className="set-filter-result-meta">
                  {s.code.toUpperCase()}
                  {year ? ` · ${year}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
