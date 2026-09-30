import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { SearchPill } from '@/components/search/SearchPill';
import { Button } from '@/components/shared/Button';
import type { DailyNames } from '@/lib/daily/names';

interface Props {
  names: DailyNames | null;
  /** Names already guessed today: suggested but marked. */
  guessed: readonly string[];
  disabled?: boolean;
  /** Resolves to null when the guess counted, or the sentence saying why not. */
  onGuess: (name: string) => Promise<string | null>;
}

/**
 * The guess box: a combobox over every card name (not just likely answers, so
 * the list gives nothing away). Same wiring as DiscoverSearch: nothing is
 * highlighted until an arrow key, Enter takes the highlight or else the typed
 * name, Escape closes the list. The server decides whether a name counts.
 */
export function GuessInput({ names, guessed, disabled, onGuess }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listboxId = useId();
  const errorId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = names && open ? names.suggest(text) : [];
  const showListbox = results.length > 0;
  const activeIndex = showListbox && highlight >= 0 ? Math.min(highlight, results.length - 1) : -1;

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const submit = async (raw: string) => {
    const name = raw.trim();
    if (busy) return;
    if (!name) {
      setError('Type a card name.');
      return;
    }
    setBusy(true);
    setOpen(false);
    const problem = await onGuess(name);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setText('');
    setHighlight(-1);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length === 0) return;
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      setHighlight((h) => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void submit(activeIndex >= 0 ? results[activeIndex]! : text);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const off = disabled || !names;
  return (
    <div className="daily-guess" ref={wrapperRef}>
      <div className="daily-guess-row">
        <SearchPill
          ref={inputRef}
          className="daily-guess-field"
          inputType="text"
          value={text}
          onChange={(next) => {
            setText(next);
            setOpen(true);
            setHighlight(-1);
            setError(null);
          }}
          placeholder={names ? 'Type a card name' : 'Loading card names…'}
          ariaLabel="Card name"
          hideClear
          inputProps={{
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-expanded': showListbox,
            'aria-controls': listboxId,
            'aria-activedescendant':
              activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': error ? errorId : undefined,
            'aria-busy': busy || undefined,
            disabled: off,
            autoComplete: 'off',
            spellCheck: false,
            onFocus: () => setOpen(true),
            onKeyDown,
          }}
        />
        <Button variant="primary" onClick={() => void submit(text)} disabled={off || busy}>
          Guess
        </Button>
      </div>
      {showListbox && (
        <ul id={listboxId} className="daily-guess-options" role="listbox" aria-label="Card names">
          {results.map((name, i) => (
            <li
              key={name}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              aria-disabled={guessed.includes(name) || undefined}
              className={`daily-guess-option${i === activeIndex ? ' is-highlight' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                void submit(name);
              }}
            >
              <span className="daily-guess-option-name">{name}</span>
              {guessed.includes(name) && <span className="daily-guess-option-note">Guessed</span>}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={errorId} className="daily-guess-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
