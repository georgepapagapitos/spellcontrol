import { Check, ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ManaCost } from './ManaCost';
import { SearchPill } from './SearchPill';
import { PrintingPicker, FINISH_LABEL, type AddExtras } from './PrintingPicker';
import { useCardCarousel, type CarouselEntry } from './deck/useCardCarousel';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { availableFinishes } from '../lib/scanner-feedback';
import { imageFromCard } from '../lib/card-thumbs';
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
 * Each result leads with a mini-card thumbnail that opens the full card in the
 * preview carousel (you should never have to add a card you can't see), then
 * quick-adds one copy via "+" (Enter on the active row does the same), shows an
 * added ×N count with a "−" undo for mis-taps, and carries a "Printing &
 * finish" disclosure ({@link PrintingPicker}) for choosing an exact printing,
 * finish, quantity, condition and language before adding.
 *
 * Every add confirms itself twice over: the row flips to its added state, and a
 * success toast names exactly what landed (quantity · set · finish) with an
 * Undo that removes that add's copies — not just the last one.
 */
export function AddCardSearchPanel({ binderId, autoFocus = true, onEscape }: Props) {
  const addCard = useCollectionStore((s) => s.addCard);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
  const collection = useCollectionStore((s) => s.cards);
  const pushToast = useToastsStore((s) => s.push);

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

  // Drop specific copies added this session. replaceAllCards re-runs
  // allocation/binder remapping, same as the edit flow. One path for both undo
  // affordances — the row's "−" (last copy) and the toast's Undo (that add's
  // whole batch, so undoing a 4× add doesn't silently leave 3 behind).
  const removeCopies = async (resultId: string, ids: string[]) => {
    if (ids.length === 0) return;
    const dropping = new Set(ids);
    setAdded((prev) => ({
      ...prev,
      [resultId]: (prev[resultId] ?? []).filter((id) => !dropping.has(id)),
    }));
    if (binderId) for (const id of ids) removeCardFromBinder(binderId, id, false);
    await replaceAllCards(
      useCollectionStore.getState().cards.filter((c) => !dropping.has(c.copyId))
    );
    haptics.tap();
  };

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
    // Name exactly what landed — a "+" that only swaps to a checkmark reads as
    // "did that register?", especially on a phone where the row is small and
    // the collection isn't on screen to confirm against.
    const qty = copyIds.length;
    const detail = [
      `${card.set.toUpperCase()} #${card.collector_number}`,
      finish ? FINISH_LABEL[finish] : null,
      binderId ? 'pinned to this binder' : null,
    ].filter(Boolean);
    pushToast({
      message: `Added ${qty > 1 ? `${qty} × ` : ''}${card.name} · ${detail.join(' · ')}`,
      tone: 'success',
      durationMs: 4000,
      actionLabel: 'Undo',
      onAction: () => void removeCopies(resultId, copyIds),
    });
  };

  // Remove the most recently added copy of this result.
  const undoAdd = (resultId: string) => {
    const ids = added[resultId] ?? [];
    const last = ids[ids.length - 1];
    if (last) void removeCopies(resultId, [last]);
  };

  // Carousel entries mirror `results` 1:1 and carry the full card, so every
  // slide is swipeable and fully rendered the instant the preview opens. The
  // context line under the art reports this session's add count, else whether
  // the card is already in the collection.
  const previewEntries: CarouselEntry[] = results.map((c) => {
    const count = added[c.id]?.length ?? 0;
    return {
      name: c.name,
      label: count > 0 ? `Added ×${count}` : ownedNames.has(c.name) ? 'In your collection' : '',
      card: c,
    };
  });

  // The preview carries the same Add action as the row, so a card can be read
  // in full and added without backing out to the list.
  const carousel = useCardCarousel('Add cards', (entry) => {
    const card = entry.card;
    if (!card) return [];
    const count = added[card.id]?.length ?? 0;
    return [
      {
        key: 'add',
        icon:
          count > 0 ? (
            <Check width={18} height={18} strokeWidth={2.4} aria-hidden />
          ) : (
            <Plus width={18} height={18} strokeWidth={2.4} aria-hidden />
          ),
        label: count > 0 ? `Added ×${count}` : 'Add',
        onClick: () => void handleAdd(card.id, card),
      },
    ];
  });

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
              // Full card (not an art crop) so the printing is recognizable at
              // thumbnail size; the search result already carries its images, so
              // this costs no extra request.
              const thumb = imageFromCard(c, 'normal');
              return (
                <li
                  key={c.id}
                  id={`add-card-result-${i}`}
                  role="option"
                  aria-selected={active}
                  className="card-search-item"
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <div
                    className={`card-search-row add-card-row has-thumb${active ? ' active' : ''}`}
                  >
                    <button
                      type="button"
                      className="card-search-add"
                      aria-label={addedCount > 0 ? `Add another ${c.name}` : `Add ${c.name}`}
                      onClick={() => void handleAdd(c.id, c)}
                    >
                      {addedCount > 0 ? (
                        <Check width={10} height={10} strokeWidth={2.5} aria-hidden />
                      ) : (
                        '+'
                      )}
                    </button>
                    <button
                      type="button"
                      className="card-search-thumb"
                      aria-label={`Preview ${c.name}`}
                      title="Preview card"
                      onClick={() => carousel.open(previewEntries, c.name)}
                    >
                      {thumb && <img src={thumb} alt="" loading="lazy" />}
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
      {carousel.preview}
    </div>
  );
}
