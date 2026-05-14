import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import { ManaCost } from './ManaCost';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import type { ScryfallCard } from '@/deck-builder/types';

interface Props {
  /** When provided, the card is also pinned to this binder after being added to the collection. */
  binderId?: string;
  binderName?: string;
  onClose: () => void;
}

export function AddCardSheet({ binderId, binderName, onClose }: Props) {
  const addCard = useCollectionStore((s) => s.addCard);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  const collection = useCollectionStore((s) => s.cards);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useLockBodyScroll();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (query) setQuery('');
        else onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, query]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const q = query.trim();
      if (q.length < 2) {
        if (!cancelled) {
          setError(null);
          setResults([]);
        }
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, 300);
      });
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const resp = await searchCards(q, [], { skipFormatFilter: true });
        if (!cancelled) {
          setResults(resp.data.slice(0, 60));
          setActiveIndex(0);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const ownedNames = new Set(collection.map((c) => c.name));

  const handleAdd = async (card: ScryfallCard) => {
    const copyId = await addCard(card);
    if (binderId) {
      pinCardToBinder(binderId, copyId);
    }
    setRecentlyAdded((prev) => new Set(prev).add(card.id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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

  const title = binderId ? `Add card to ${binderName ?? 'binder'}` : 'Add card to collection';

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet add-card-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">{title}</h2>
          <input
            ref={inputRef}
            type="search"
            className="card-picker-search"
            placeholder="Search Scryfall..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search Scryfall"
          />
          {binderId && (
            <p className="add-card-sheet-hint">
              Cards are added to your collection and pinned to this binder.
            </p>
          )}
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

        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
