import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Minus, Plus, Search, Trash2, X } from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { fetchPrintings } from '../lib/api';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import {
  FINISH_LABELS,
  availableFinishes,
  finishUnitPrice,
  nextFinish,
} from '../lib/scanner-feedback';
import { logger } from '@/lib/logger';
import { useConfirm } from '../lib/use-confirm';

export interface ScannedEntry {
  /** Stable row id = oracle_id + finish (see useScanQueue's entryKey), so a
   *  foil and a nonfoil copy of the same card are distinct rows. Different
   *  printings of the same card+finish share a row. */
  id: string;
  card: ScryfallCard;
  qty: number;
  /** Owned finish for this row. Toggled in the UI; round-trips to the
   *  collection as a foil/etched copy via the import text. */
  finish: Finish;
  /** Raw OCR text that produced this entry — surfaced as a `title` tooltip. */
  rawText: string;
}

interface Props {
  entries: ScannedEntry[];
  onClose: () => void;
  onChangePrinting: (entryId: string, newCard: ScryfallCard) => void;
  /** Set the owned finish (nonfoil / foil / etched) for an entry. */
  onChangeFinish: (entryId: string, finish: Finish) => void;
  onChangeQty: (entryId: string, delta: number) => void;
  onRemove: (entryId: string) => void;
  onClearAll: () => void;
  /**
   * Add a card chosen from the in-sheet Scryfall search to the queue. Wired
   * to the scan queue's manual-add path, so searched cards flow through the
   * same review-and-confirm step as scanned ones.
   */
  onAddCard: (card: ScryfallCard) => void;
  /**
   * Commit the queue to the parent flow (closes the scanner and pipes
   * the scanned cards through the import pipeline). The scanner UI no
   * longer has its own footer CTA — the sheet owns commit, since the
   * sheet is also where the user reviews qty and printings.
   */
  onConfirm: () => void;
  /**
   * When set, the matching row's printing picker is expanded on mount — lets
   * the scanner panel's set·# tap land the user directly on the picker.
   */
  initialPickerFor?: string | null;
}

/**
 * Bottom-sheet review of every card the scanner has captured this session.
 *
 * Lets the user step quantities, swap printings (lazy-loaded from
 * Scryfall — one round-trip per row on first open, cached for the
 * sheet's lifetime), or drop cards entirely. The "Add N cards" CTA
 * lives in this sheet's footer — committing the queue is the natural
 * follow-on once you've reviewed it.
 */
export function ScannerQueueSheet({
  entries,
  onClose,
  onChangePrinting,
  onChangeFinish,
  onChangeQty,
  onRemove,
  onClearAll,
  onConfirm,
  onAddCard,
  initialPickerFor,
}: Props) {
  const totalCount = entries.reduce((sum, e) => sum + e.qty, 0);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const handleClearAll = useCallback(async () => {
    const ok = await confirm({
      title: 'Clear scanned cards?',
      body: `This removes all ${totalCount} scanned ${
        totalCount === 1 ? 'card' : 'cards'
      } from this scanning session. They won't be added to your collection.`,
      confirmLabel: 'Clear all',
      danger: true,
    });
    if (ok) onClearAll();
  }, [confirm, onClearAll, totalCount]);

  // In-sheet Scryfall search ("add a card you don't have in hand"). Debounced,
  // tap-to-add; mirrors the collection's AddCardSearchPanel but routes adds
  // into the scan queue instead of straight to the collection.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Printing ids added this session — flips the row's + to a ✓ so the user
  // sees the tap registered without the result list reshuffling.
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const q = query.trim();
      if (q.length < 2) {
        if (!cancelled) {
          setSearchError(null);
          setResults([]);
          setSearching(false);
        }
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, 300);
      });
      if (cancelled) return;
      setSearching(true);
      setSearchError(null);
      try {
        const resp = await searchCards(q, [], { skipFormatFilter: true });
        if (!cancelled) setResults(resp.data.slice(0, 40));
      } catch (e) {
        if (!cancelled) {
          setSearchError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleAddFromSearch = useCallback(
    (card: ScryfallCard) => {
      onAddCard(card);
      setAddedIds((prev) => new Set(prev).add(card.id));
    },
    [onAddCard]
  );

  // Only one printing-picker open at a time — phones can't usefully render
  // two side-by-side. The id is the entry id (oracle_id).
  const [openPickerFor, setOpenPickerFor] = useState<string | null>(null);

  // Printings cache scoped to this sheet instance. A re-mount (sheet closed
  // and re-opened) drops it, but a single session of editing the queue
  // never re-fetches the same card's prints. Kept in state (not a ref)
  // so React re-renders the row when the fetch resolves.
  const [printsCache, setPrintsCache] = useState<Map<string, ScryfallCard[]>>(() => new Map());
  const [loadingPrintsFor, setLoadingPrintsFor] = useState<string | null>(null);

  const togglePicker = useCallback(
    async (entry: ScannedEntry) => {
      setOpenPickerFor((current) => (current === entry.id ? null : entry.id));
      if (!printsCache.has(entry.card.name)) {
        setLoadingPrintsFor(entry.id);
        try {
          const prints = await fetchPrintings(entry.card.name);
          setPrintsCache((prev) => new Map(prev).set(entry.card.name, prints));
        } catch (err) {
          logger.warn('[scanner-queue] could not fetch printings:', err);
        } finally {
          setLoadingPrintsFor((current) => (current === entry.id ? null : current));
        }
      }
    },
    [printsCache]
  );

  // Auto-expand a row's printing picker on mount when the caller asked for it
  // (the panel's set·# tap). One-shot, guarded so the later printsCache update
  // it triggers doesn't reopen a picker the user has since closed.
  const didInitPicker = useRef(false);
  useEffect(() => {
    if (didInitPicker.current || !initialPickerFor) return;
    const entry = entries.find((e) => e.id === initialPickerFor);
    if (!entry) return;
    didInitPicker.current = true;
    // Defer to a microtask so the open+fetch doesn't run as a synchronous
    // setState inside the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => togglePicker(entry));
  }, [initialPickerFor, entries, togglePicker]);

  // Escape closes the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openPickerFor) setOpenPickerFor(null);
      else if (query) setQuery('');
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, openPickerFor, query]);

  return (
    <div className="scanner-sheet" role="dialog" aria-modal="true" aria-label="Scanned cards">
      <div className="scanner-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="scanner-sheet-panel">
        <header className="scanner-sheet-header">
          <div className="scanner-sheet-title">
            <span>Scanned cards</span>
            <span className="scanner-sheet-count">{totalCount}</span>
          </div>
          <button
            type="button"
            className="scanner-icon-btn"
            onClick={onClose}
            aria-label="Close scanned cards"
          >
            <X width={18} height={18} strokeWidth={1.8} />
          </button>
        </header>

        <div className="scanner-search">
          <div className="scanner-search-field">
            <Search width={16} height={16} strokeWidth={1.8} aria-hidden />
            {/* type="text" (not "search"): the Android WebView paints the
                native search control with an opaque white background that
                ignores author `background` + `appearance`, and it resolves the
                control's color-scheme from <html> (a light theme) rather than
                our dark scanner island. A plain text input honors the
                transparent background, so the dark pill shows through. */}
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="scanner-search-input"
              placeholder="Search Scryfall to add a card…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search Scryfall to add a card"
            />
          </div>
          {query.trim().length >= 2 && (
            <div className="scanner-search-results">
              {searching && <div className="scanner-search-status">Searching…</div>}
              {searchError && (
                <div className="scanner-search-status scanner-search-error">{searchError}</div>
              )}
              {!searching && !searchError && results.length === 0 && (
                <div className="scanner-search-status">No matches.</div>
              )}
              {results.map((c) => {
                const img = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
                const added = addedIds.has(c.id);
                const usd = c.prices?.usd
                  ? ` · $${Number.parseFloat(c.prices.usd).toFixed(2)}`
                  : '';
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="scanner-search-result"
                    onClick={() => handleAddFromSearch(c)}
                    aria-label={`Add ${c.name}`}
                  >
                    <div className="scanner-search-thumb">
                      {img ? <img src={img} alt="" loading="lazy" /> : null}
                    </div>
                    <div className="scanner-search-result-body">
                      <div className="scanner-search-result-name">{c.name}</div>
                      <div className="scanner-search-result-meta">
                        {c.set.toUpperCase()} · {c.collector_number ?? '—'}
                        {usd}
                      </div>
                    </div>
                    <span className={`scanner-search-add${added ? ' added' : ''}`} aria-hidden>
                      {added ? (
                        <Check width={14} height={14} strokeWidth={2.5} />
                      ) : (
                        <Plus width={14} height={14} strokeWidth={2.5} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="scanner-sheet-empty">
            Nothing scanned yet — hold a card up to the camera, or search above to add one.
          </div>
        ) : (
          <ul className="scanner-sheet-list">
            {entries.map((entry) => {
              const img =
                entry.card.image_uris?.small || entry.card.card_faces?.[0]?.image_uris?.small;
              const isOpen = openPickerFor === entry.id;
              const isLoading = loadingPrintsFor === entry.id;
              const prints = printsCache.get(entry.card.name);
              const finishes = availableFinishes(entry.card.finishes);
              const unit = finishUnitPrice(entry.card.prices, entry.finish);
              return (
                <li key={entry.id} className="scanner-sheet-row" title={entry.rawText}>
                  <div className="scanner-sheet-row-main">
                    <div className="scanner-sheet-thumb">
                      {img ? (
                        <img src={img} alt="" loading="lazy" />
                      ) : (
                        <div className="scanner-sheet-thumb-fallback">{entry.card.name}</div>
                      )}
                    </div>
                    <div className="scanner-sheet-row-body">
                      <div className="scanner-sheet-row-name">{entry.card.name}</div>
                      <div className="scanner-sheet-row-meta">
                        {entry.card.set.toUpperCase()} · {entry.card.collector_number ?? '—'}
                        {unit != null ? (
                          <span className="scanner-sheet-row-price">${unit.toFixed(2)}</span>
                        ) : null}
                      </div>
                      <div className="scanner-sheet-row-controls">
                        <div className="scanner-qty">
                          <button
                            type="button"
                            className="scanner-qty-btn"
                            onClick={() => onChangeQty(entry.id, -1)}
                            disabled={entry.qty <= 1}
                            aria-label={`Decrease quantity of ${entry.card.name}`}
                          >
                            <Minus width={14} height={14} strokeWidth={2} />
                          </button>
                          <span className="scanner-qty-value" aria-live="polite">
                            {entry.qty}
                          </span>
                          <button
                            type="button"
                            className="scanner-qty-btn"
                            onClick={() => onChangeQty(entry.id, 1)}
                            aria-label={`Increase quantity of ${entry.card.name}`}
                          >
                            <Plus width={14} height={14} strokeWidth={2} />
                          </button>
                        </div>
                        {finishes.length > 1 && (
                          <button
                            type="button"
                            className={`scanner-finish-toggle finish-${entry.finish}`}
                            onClick={() =>
                              onChangeFinish(entry.id, nextFinish(entry.finish, finishes))
                            }
                            aria-label={`Finish of ${entry.card.name}: ${
                              FINISH_LABELS[entry.finish]
                            }. Tap to change.`}
                          >
                            {FINISH_LABELS[entry.finish]}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`scanner-printing-toggle${isOpen ? ' open' : ''}`}
                          onClick={() => void togglePicker(entry)}
                          aria-expanded={isOpen}
                          aria-label={`Change printing of ${entry.card.name}`}
                        >
                          <span>Printing</span>
                          <ChevronDown width={14} height={14} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          className="scanner-icon-btn scanner-sheet-remove"
                          onClick={() => onRemove(entry.id)}
                          aria-label={`Remove ${entry.card.name}`}
                        >
                          <Trash2 width={14} height={14} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="scanner-printing-picker">
                      {isLoading && !prints ? (
                        <div className="scanner-printing-loading">Loading printings…</div>
                      ) : prints && prints.length > 0 ? (
                        <ul className="scanner-printing-list">
                          {prints.map((print) => {
                            const printImg =
                              print.image_uris?.small || print.card_faces?.[0]?.image_uris?.small;
                            const selected =
                              print.set === entry.card.set &&
                              print.collector_number === entry.card.collector_number;
                            return (
                              <li key={print.id}>
                                <button
                                  type="button"
                                  className={`scanner-printing-item${selected ? ' selected' : ''}`}
                                  onClick={() => {
                                    onChangePrinting(entry.id, print);
                                    setOpenPickerFor(null);
                                  }}
                                >
                                  <div className="scanner-printing-thumb">
                                    {printImg ? <img src={printImg} alt="" loading="lazy" /> : null}
                                  </div>
                                  <div className="scanner-printing-meta">
                                    <div className="scanner-printing-set">
                                      {print.set.toUpperCase()} · {print.collector_number ?? '—'}
                                    </div>
                                    <div className="scanner-printing-setname">{print.set_name}</div>
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="scanner-printing-loading">No other printings.</div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {entries.length > 0 && (
          <footer className="scanner-sheet-footer">
            <button type="button" className="btn" onClick={() => void handleClearAll()}>
              <Trash2 width={14} height={14} strokeWidth={1.8} />
              <span>Clear all</span>
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Continue scanning
            </button>
            <button type="button" className="btn btn-primary" onClick={onConfirm}>
              Add {totalCount} card{totalCount === 1 ? '' : 's'}
            </button>
          </footer>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
