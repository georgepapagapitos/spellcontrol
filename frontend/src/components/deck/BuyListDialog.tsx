import { useMemo, useState } from 'react';
import { Check, Clipboard, Download, ExternalLink, X } from 'lucide-react';
import { Modal } from '../Modal';
import { formatMoney } from '../../lib/format-money';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import type { CardTally } from './useCardCarousel';
import './BuyListDialog.css';

/** One `<qty> <name>` line per unique missing card — the vendor-neutral
 *  buy-list text (paste into Cardsphere, Card Kingdom, an LGS order, …). */
export function buyListText(tally: CardTally[]): string {
  return tally.map((t) => `${t.count} ${t.name}`).join('\n');
}

/** TCGPlayer Mass Entry deep link — pre-fills their cart/optimizer with the
 *  whole list (the same integration Moxfield/Archidekt use). Mass Entry wants
 *  front-face names only, so DFC names are trimmed at ` // `. */
export function tcgplayerMassEntryUrl(tally: CardTally[]): string {
  const list = tally.map((t) => `${t.count} ${t.name.split(' // ')[0]}`).join('||');
  return `https://www.tcgplayer.com/massentry?c=${encodeURIComponent(list)}`;
}

interface Props {
  /** Unique missing cards with copy counts (the deck's missing tally). */
  tally: CardTally[];
  currency: 'USD' | 'EUR';
  /** Deck title — names the downloaded file. */
  title: string;
  onClose: () => void;
  /** Tap a row → preview that card (the parent closes this dialog, opens the
   *  carousel there, and reopens the dialog when the carousel closes). */
  onPickCard: (name: string) => void;
}

/**
 * "Buy list" dialog for a deck's missing cards — the missing stat's
 * drill-down. Lists qty × name with line prices (rows tap through to the card
 * carousel), and offers the three acquisition paths: open the whole list in
 * TCGPlayer Mass Entry, copy the plain-text list, or download it as a .txt.
 */
export function BuyListDialog({ tally, currency, title, onClose, onPickCard }: Props) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => buyListText(tally), [tally]);
  const rows = useMemo(
    () =>
      tally.map((t) => {
        const unit = t.card ? Number(getCardPrice(t.card, currency)) : NaN;
        return { ...t, price: Number.isFinite(unit) ? unit * t.count : 0 };
      }),
    [tally, currency]
  );
  const total = useMemo(() => rows.reduce((sum, r) => sum + r.price, 0), [rows]);
  const count = useMemo(() => tally.reduce((sum, t) => sum + t.count, 0), [tally]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  const handleDownload = () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'deck';
    a.download = `${safeName} buy list.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal onClose={onClose} className="modal buy-list-dialog" labelledBy="buy-list-title">
      <div className="buy-list-header">
        <h2 id="buy-list-title" className="buy-list-title">
          Buy list
        </h2>
        <button type="button" className="buy-list-close" aria-label="Close" onClick={onClose}>
          <X width={18} height={18} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <p className="buy-list-meta">
        {count} {count === 1 ? 'card' : 'cards'} missing · {formatMoney(total, { currency })}
      </p>
      <ul className="buy-list-rows">
        {rows.map((r) => (
          <li key={r.name}>
            <button
              type="button"
              className="buy-list-row"
              onClick={() => onPickCard(r.name)}
              aria-label={`Preview ${r.name}`}
            >
              <span className="buy-list-row-qty">{r.count}×</span>
              <span className="buy-list-row-name">{r.name}</span>
              <span className="buy-list-row-price">{formatMoney(r.price, { currency })}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="buy-list-actions">
        <button
          type="button"
          className="btn"
          onClick={handleDownload}
          aria-label="Download as text file"
        >
          <Download width={14} height={14} strokeWidth={2} aria-hidden />
          <span>Download</span>
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleCopy}
          aria-label="Copy list to clipboard"
        >
          {copied ? (
            <Check width={14} height={14} strokeWidth={2.5} aria-hidden />
          ) : (
            <Clipboard width={14} height={14} strokeWidth={2} aria-hidden />
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <a
          className="btn btn-primary"
          href={tcgplayerMassEntryUrl(tally)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>Buy on TCGPlayer</span>
          <ExternalLink width={14} height={14} strokeWidth={2} aria-hidden />
        </a>
      </div>
    </Modal>
  );
}
