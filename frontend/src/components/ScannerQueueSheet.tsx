import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Minus, Plus, Trash2, X } from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import { fetchPrintings } from '../lib/api';
import { logger } from '@/lib/logger';

export interface ScannedEntry {
  /** Stable id (oracle_id). Identical across reprints so qty-stepper works. */
  id: string;
  card: ScryfallCard;
  qty: number;
  /** Raw OCR text that produced this entry — surfaced as a `title` tooltip. */
  rawText: string;
}

interface Props {
  entries: ScannedEntry[];
  onClose: () => void;
  onChangePrinting: (entryId: string, newCard: ScryfallCard) => void;
  onChangeQty: (entryId: string, delta: number) => void;
  onRemove: (entryId: string) => void;
  onClearAll: () => void;
}

/**
 * Bottom-sheet review of every card the scanner has captured this session.
 *
 * Lets the user step quantities, swap printings (lazy-loaded from
 * Scryfall — one round-trip per row on first open, cached for the
 * sheet's lifetime), or drop cards entirely. The scanner's primary
 * "Add N cards" CTA stays in the scanner footer; this sheet only edits
 * the staging queue, it does not own the confirm/commit step.
 */
export function ScannerQueueSheet({
  entries,
  onClose,
  onChangePrinting,
  onChangeQty,
  onRemove,
  onClearAll,
}: Props) {
  const totalCount = entries.reduce((sum, e) => sum + e.qty, 0);

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

  // Escape closes the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openPickerFor) setOpenPickerFor(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, openPickerFor]);

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

        {entries.length === 0 ? (
          <div className="scanner-sheet-empty">
            Nothing scanned yet — hold a card inside the viewfinder.
          </div>
        ) : (
          <ul className="scanner-sheet-list">
            {entries.map((entry) => {
              const img =
                entry.card.image_uris?.small || entry.card.card_faces?.[0]?.image_uris?.small;
              const isOpen = openPickerFor === entry.id;
              const isLoading = loadingPrintsFor === entry.id;
              const prints = printsCache.get(entry.card.name);
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
                        {entry.card.prices?.usd ? (
                          <span className="scanner-sheet-row-price">
                            ${Number.parseFloat(entry.card.prices.usd).toFixed(2)}
                          </span>
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
            <button type="button" className="btn" onClick={onClearAll}>
              <Trash2 width={14} height={14} strokeWidth={1.8} />
              <span>Clear all</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Continue scanning
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
