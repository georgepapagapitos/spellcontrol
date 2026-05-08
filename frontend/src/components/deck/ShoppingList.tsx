import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { classifyAllocation } from '../../lib/allocations';
import type { EnrichedCard } from '../../types';
import type { DeckCard } from '../../store/decks';

interface ShoppingListProps {
  /** Deck id — used to persist the "fully built" banner dismissal per-deck. */
  deckId: string;
  cards: DeckCard[];
  collectionByScryfallId: Map<string, EnrichedCard> | undefined;
}

const FULLY_BUILT_DISMISS_KEY = (deckId: string) => `mtg-shopping-list-dismissed:${deckId}`;

interface MissingRow {
  name: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  card: ScryfallCard;
}

function priceOf(card: ScryfallCard): number {
  const raw = getCardPrice(card, 'USD');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function ShoppingList({ deckId, cards, collectionByScryfallId }: ShoppingListProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Hydrate the per-deck dismissed flag once the editor mounts. Reset when
  // switching decks so each deck remembers its own state.
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(FULLY_BUILT_DISMISS_KEY(deckId)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [deckId]);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(FULLY_BUILT_DISMISS_KEY(deckId), '1');
    } catch {
      /* ignore quota / private-mode failures */
    }
  };

  const rows = useMemo<MissingRow[]>(() => {
    const grouped = new Map<string, MissingRow>();
    for (const dc of cards) {
      const status = classifyAllocation(dc.allocatedScryfallId, collectionByScryfallId);
      if (status === 'allocated') continue;
      const existing = grouped.get(dc.card.name);
      const unit = priceOf(dc.card);
      if (existing) {
        existing.qty += 1;
        existing.totalPrice += unit;
        continue;
      }
      grouped.set(dc.card.name, {
        name: dc.card.name,
        qty: 1,
        unitPrice: unit,
        totalPrice: unit,
        card: dc.card,
      });
    }
    return [...grouped.values()].sort((a, b) => b.totalPrice - a.totalPrice);
  }, [cards, collectionByScryfallId]);

  const totalUnique = rows.length;
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const grandTotal = rows.reduce((s, r) => s + r.totalPrice, 0);

  if (totalUnique === 0) {
    if (dismissed) return null;
    return (
      <section className="shopping-list shopping-list-empty">
        <span className="shopping-list-good">Fully built from your collection</span>
        <button
          type="button"
          className="shopping-list-dismiss"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={handleDismiss}
        >
          ×
        </button>
      </section>
    );
  }

  return (
    <section className="shopping-list">
      <header className="shopping-list-header">
        <div className="shopping-list-summary">
          <strong className="shopping-list-title">Shopping list</strong>
          <span className="shopping-list-meta">
            {totalQty} {totalQty === 1 ? 'card' : 'cards'} not in your collection · estimated{' '}
            {fmtMoney(grandTotal)}
          </span>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </header>

      {open && (
        <ul className="shopping-list-rows">
          {rows.map((r) => (
            <li key={r.name} className="shopping-list-row">
              <span className="shopping-list-qty">{r.qty}×</span>
              <span className="shopping-list-name">{r.name}</span>
              <span className="shopping-list-price">{fmtMoney(r.totalPrice)}</span>
              <a
                className="btn-link shopping-list-buy"
                href={`https://scryfall.com/search?q=${encodeURIComponent(`!"${r.name}"`)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Buy
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
