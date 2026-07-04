import { Check, ChevronDown, ChevronRight, Minus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ManaCost } from './ManaCost';
import { SearchPill } from './SearchPill';
import { PrintingPicker, type AddExtras } from './PrintingPicker';
import { useCollectionStore } from '../store/collection';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { availableFinishes } from '../lib/scanner-feedback';
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
 *
 * Each result quick-adds one copy via "+" (Enter on the active row does the
 * same), shows an added ×N count with a "−" undo for mis-taps, and carries a
 * "Printing & finish" disclosure ({@link PrintingPicker}) for choosing an
 * exact printing, finish, quantity, condition and language before adding.
 */
export function AddCardSearchPanel({ binderId, autoFocus = true, onEscape }: Props) {
  const addCard = useCollectionStore((s) => s.addCard);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
  const collection = useCollectionStore((s) => s.cards);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [openPrintingsId, setOpenPrintingsId] = useState<string | null>(null);
  // copyIds added this session, keyed by result card id — powers the ×N count
  // and the "−" undo.
  const [added, setAdded] = useState<Record<string, string[]>>({});

  const { results, loading, error } = useSearchCards(query);

  // Reset keyboard-navigation index whenever the result set changes.
  // Defer to a microtask to avoid synchronous setState inside an effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(() => {
      setActiveIndex(0);
      setOpenPrintingsId(null);
    });
  }, [results]);

  const ownedNames = new Set(collection.map((c) => c.name));

  const handleAdd = async (
    resultId: string,
    card: ScryfallCard,
    finish?: Finish,
    extras?: AddExtras
  ) => {
    const copyIds = await addCard(card, finish, extras);
    if (binderId) for (const copyId of copyIds) pinCardToBinder(binderId, copyId);
    setAdded((prev) => ({ ...prev, [resultId]: [...(prev[resultId] ?? []), ...copyIds] }));
    haptics.tap();
  };

  // Remove the most recently added copy of this result. replaceAllCards
  // re-runs allocation/binder remapping, same as the edit flow.
  const undoAdd = async (resultId: string) => {
    const ids = added[resultId];
    const last = ids?.[ids.length - 1];
    if (!last) return;
    setAdded((prev) => ({ ...prev, [resultId]: ids.slice(0, -1) }));
    if (binderId) removeCardFromBinder(binderId, last, false);
    await replaceAllCards(useCollectionStore.getState().cards.filter((c) => c.copyId !== last));
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
      if (card) void handleAdd(card.id, card);
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
              const addedCount = added[c.id]?.length ?? 0;
              const active = i === activeIndex;
              const printingsOpen = openPrintingsId === c.id;
              const finishes = availableFinishes(c.finishes);
              return (
                <li
                  key={c.id}
                  id={`add-card-result-${i}`}
                  role="option"
                  aria-selected={active}
                  className="card-search-item"
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <div className={`card-search-row add-card-row${active ? ' active' : ''}`}>
                    <button
                      type="button"
                      className="card-search-add"
                      aria-label={`Add ${c.name}`}
                      onClick={() => void handleAdd(c.id, c)}
                    >
                      {addedCount > 0 ? (
                        <Check width={10} height={10} strokeWidth={2.5} aria-hidden />
                      ) : (
                        '+'
                      )}
                    </button>
                    <span className="card-search-name">{c.name}</span>
                    {c.mana_cost && <ManaCost cost={c.mana_cost} className="card-search-mana" />}
                    <button
                      type="button"
                      className={`inline-card-search-printings-toggle${
                        printingsOpen ? ' is-open' : ''
                      }`}
                      aria-expanded={printingsOpen}
                      onClick={() => setOpenPrintingsId(printingsOpen ? null : c.id)}
                    >
                      {printingsOpen ? (
                        <ChevronDown width={12} height={12} strokeWidth={2} aria-hidden />
                      ) : (
                        <ChevronRight width={12} height={12} strokeWidth={2} aria-hidden />
                      )}
                      {finishes.length > 1 ? 'Printing & finish' : 'Printing'}
                    </button>
                    <span className="card-search-meta">
                      {owned ? 'owned' : ''}
                      {addedCount > 0 && (
                        <span className="add-card-sheet-added">added ×{addedCount}</span>
                      )}
                      {addedCount > 0 && (
                        <button
                          type="button"
                          className="inline-card-search-undo"
                          aria-label={`Remove last added copy of ${c.name}`}
                          onClick={() => void undoAdd(c.id)}
                        >
                          <Minus width={12} height={12} strokeWidth={2.5} aria-hidden />
                        </button>
                      )}
                    </span>
                  </div>
                  {printingsOpen && (
                    <PrintingPicker
                      cardName={c.name}
                      fallback={c}
                      showExtras
                      onAdd={(printing, finish, extras) =>
                        void handleAdd(c.id, printing, finish, extras)
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
