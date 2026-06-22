import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ManaCost } from './ManaCost';
import { SearchPill } from './SearchPill';
import { useCollectionStore } from '../store/collection';
import type { ScryfallCard } from '@/deck-builder/types';
import { haptics } from '../lib/haptics';
import { useSearchCards } from '../lib/use-search-cards';

interface Props {
  /** When provided, the card is also pinned to this binder after being added. */
  binderId?: string;
  /** Focus the search input on mount. Default true. */
  autoFocus?: boolean;
  /** Escape behavior: clear the query, then bubble up to the caller. The caller
   *  decides what bubbling means (close the dialog, switch tab, etc.). */
  onEscape?: () => void;
}

/**
 * The reusable search-and-add body shared by {@link AddCardSheet} (the
 * binder-pin variant) and the unified add-cards modal's Search tab. Just the
 * input + results list — no dialog chrome — so it composes inside any
 * container.
 */
export function AddCardSearchPanel({ binderId, autoFocus = true, onEscape }: Props) {
  const addCard = useCollectionStore((s) => s.addCard);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  const collection = useCollectionStore((s) => s.cards);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());

  const { results, loading, error } = useSearchCards(query);

  // Reset keyboard-navigation index whenever the result set changes.
  // Defer to a microtask to avoid synchronous setState inside an effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(() => setActiveIndex(0));
  }, [results]);

  const ownedNames = new Set(collection.map((c) => c.name));

  const handleAdd = async (card: ScryfallCard) => {
    const copyId = await addCard(card);
    if (binderId) pinCardToBinder(binderId, copyId);
    setRecentlyAdded((prev) => new Set(prev).add(card.id));
    haptics.tap();
  };

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
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      if (results.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (results.length === 0) return;
      e.preventDefault();
      const idx = Math.min(activeIndex, results.length - 1);
      const card = results[idx];
      if (card) handleAdd(card);
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
        {loading && <p className="card-picker-empty">Searching...</p>}
        {error && <p className="card-picker-empty add-card-sheet-error">{error}</p>}
        {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
          <p className="card-picker-empty">No matches.</p>
        )}
        {results.length > 0 && (
          <ul className="card-search-results" role="listbox">
            {results.map((c, i) => {
              const owned = ownedNames.has(c.name);
              const justAdded = recentlyAdded.has(c.id);
              const active = i === activeIndex;
              return (
                <li
                  key={c.id}
                  id={`add-card-result-${i}`}
                  role="option"
                  aria-selected={active}
                  className={`card-search-row${active ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <button
                    type="button"
                    className="card-search-add"
                    aria-label={`Add ${c.name}`}
                    onClick={() => handleAdd(c)}
                  >
                    {justAdded ? (
                      <Check width={10} height={10} strokeWidth={2.5} aria-hidden />
                    ) : (
                      '+'
                    )}
                  </button>
                  <span className="card-search-name">{c.name}</span>
                  {c.mana_cost && <ManaCost cost={c.mana_cost} className="card-search-mana" />}
                  <span className="card-search-meta">
                    {owned ? 'owned' : ''}
                    {justAdded && <span className="add-card-sheet-added">added</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
