import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, Trash2 } from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Condition, Finish } from '../types';
import { Modal } from './Modal';
import { SearchPill } from './SearchPill';
import { SelectMenu } from './SelectMenu';
import { SegmentedControl } from './shared/form';
import { conditionLabel } from './shared/CardRow';
import { fetchPrintings } from '../lib/api';
import { formatMoney } from '../lib/format-money';
import { userMessage } from '../lib/user-error';
import { useCollectionStore } from '../store/collection';
import {
  CONDITIONS,
  FINISH_LABELS,
  availableFinishes,
  finishUnitPrice,
} from '../lib/scanner-feedback';
import type { ScannedEntry } from '../lib/use-scan-queue';
import { SCANNER_SHEET_BACKDROP } from './ScannerQueueSheet';

interface Props {
  entry: ScannedEntry;
  onClose: () => void;
  onFinish: (finish: Finish) => void;
  onCondition: (condition: Condition) => void;
  onQty: (delta: number) => void;
  onPrinting: (card: ScryfallCard) => void;
  onRemove: () => void;
}

/** Printings shown before "Show more". A basic land has hundreds. */
const PRINTINGS_PAGE = 30;

function bigImage(card: ScryfallCard): string | undefined {
  return (
    card.image_uris?.large ||
    card.image_uris?.normal ||
    card.card_faces?.[0]?.image_uris?.large ||
    card.card_faces?.[0]?.image_uris?.normal
  );
}

/**
 * Edit one scanned row: every choice on screen at once, each applying as you
 * tap, so there's no Save. Opened from a list row or from the camera's
 * last-scan panel. The printing choice swaps the sheet to a grid of every
 * printing's art, the call a set code alone can't make.
 */
export function ScannerEditSheet({
  entry,
  onClose,
  onFinish,
  onCondition,
  onQty,
  onPrinting,
  onRemove,
}: Props) {
  const [view, setView] = useState<'edit' | 'printing'>('edit');
  const [zoomed, setZoomed] = useState(false);
  const { card } = entry;
  const condition = entry.condition ?? 'nm';
  const finishes = availableFinishes(card.finishes);
  const unit = finishUnitPrice(card.prices, entry.finish);
  const img = bigImage(card);

  // "You own 2 already": one collection row per physical copy.
  const owned = useCollectionStore((s) =>
    s.cards.reduce((n, c) => {
      const same = card.oracle_id ? c.oracleId === card.oracle_id : c.name === card.name;
      return same ? n + 1 : n;
    }, 0)
  );

  return (
    <Modal
      onClose={onClose}
      className="modal scanner-edit-sheet"
      backdropClassName={SCANNER_SHEET_BACKDROP}
      labelledBy="scanner-edit-title"
    >
      {view === 'printing' ? (
        <PrintingGrid
          card={card}
          onBack={() => setView('edit')}
          onPick={(p) => {
            onPrinting(p);
            setView('edit');
          }}
        />
      ) : (
        <>
          <div className="modal-header scanner-sheet-head">
            <div className="scanner-sheet-heading">
              <h2 id="scanner-edit-title">{card.name}</h2>
              <span className="scanner-sheet-sub">{card.type_line}</span>
            </div>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          <div className="modal-body scanner-edit-body">
            <div className={`scanner-edit-top${zoomed ? ' is-zoomed' : ''}`}>
              <button
                type="button"
                className="scanner-edit-img"
                onClick={() => setZoomed((z) => !z)}
                aria-label={zoomed ? 'Show the card smaller' : 'Show the card full size'}
                aria-expanded={zoomed}
              >
                {img ? <img src={img} alt={card.name} /> : <span>{card.name}</span>}
              </button>
              {!zoomed && (
                <div className="scanner-edit-info">
                  <p className="scanner-edit-price">
                    {unit != null ? formatMoney(unit) : 'No price'}
                    <span>Market</span>
                  </p>
                  <p className="scanner-edit-meta">
                    {FINISH_LABELS[entry.finish]} · {conditionLabel(condition)}
                  </p>
                  {owned > 0 && <p className="scanner-edit-owned">You own {owned} already</p>}
                  <p className="scanner-edit-meta">Tap the card to see it full size.</p>
                </div>
              )}
            </div>

            <div className="scanner-edit-field">
              <span className="form-field-label">Printing</span>
              <button
                type="button"
                className="scanner-edit-pick"
                onClick={() => setView('printing')}
                aria-label={`Printing: ${card.set_name} number ${card.collector_number}. Choose another.`}
              >
                <b>
                  {card.set.toUpperCase()} #{card.collector_number ?? '—'}
                </b>
                <span>{card.set_name}</span>
                <ChevronRight width={16} height={16} strokeWidth={2} aria-hidden />
              </button>
            </div>

            {finishes.length > 1 && (
              <div className="scanner-edit-field">
                <span className="form-field-label">Finish</span>
                <SegmentedControl<Finish>
                  ariaLabel="Finish"
                  value={entry.finish}
                  options={finishes.map((f) => {
                    const p = finishUnitPrice(card.prices, f);
                    return {
                      value: f,
                      ariaLabel:
                        p != null ? `${FINISH_LABELS[f]}, ${formatMoney(p)}` : FINISH_LABELS[f],
                      label: (
                        <span className="scanner-seg-price">
                          {FINISH_LABELS[f]}
                          {p != null && <small>{formatMoney(p)}</small>}
                        </span>
                      ),
                    };
                  })}
                  onChange={onFinish}
                />
              </div>
            )}

            <div className="scanner-edit-field">
              <span className="form-field-label">Condition</span>
              <SelectMenu<string>
                ariaLabel="Condition"
                value={condition}
                options={CONDITIONS.map((c) => ({ value: c, label: conditionLabel(c) }))}
                onChange={(c) => onCondition(c as Condition)}
              />
            </div>

            <div className="scanner-edit-field scanner-edit-qty">
              <span className="form-field-label" id="scanner-edit-qty-label">
                Quantity
              </span>
              <div
                className="scanner-stepper"
                role="group"
                aria-labelledby="scanner-edit-qty-label"
              >
                <button
                  type="button"
                  onClick={() => onQty(-1)}
                  disabled={entry.qty <= 1}
                  aria-label="One fewer"
                >
                  <Minus width={16} height={16} strokeWidth={2} />
                </button>
                <output aria-live="polite">{entry.qty}</output>
                <button type="button" onClick={() => onQty(1)} aria-label="One more">
                  <Plus width={16} height={16} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>

          <div className="modal-footer scanner-sheet-foot">
            <button type="button" className="btn scanner-danger-btn" onClick={onRemove}>
              <Trash2 width={14} height={14} strokeWidth={1.8} aria-hidden />
              Remove
            </button>
            <button type="button" className="btn btn-primary scanner-sheet-add" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Every printing of the card as its real art, with set, number and price. */
function PrintingGrid({
  card,
  onBack,
  onPick,
}: {
  card: ScryfallCard;
  onBack: () => void;
  onPick: (card: ScryfallCard) => void;
}) {
  const [printings, setPrintings] = useState<ScryfallCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PRINTINGS_PAGE);

  useEffect(() => {
    let cancelled = false;
    fetchPrintings(card.name)
      .then((ps) => {
        // The card's own printing leads, so what's picked now is in view
        // without scrolling; the rest keep the server's order.
        const list = ps.length > 0 ? ps : [card];
        const own = list.filter((p) => p.id === card.id);
        if (!cancelled) setPrintings([...own, ...list.filter((p) => p.id !== card.id)]);
      })
      .catch((e) => {
        if (!cancelled) setError(userMessage(e, "Couldn't load the printings. Try again."));
      });
    return () => {
      cancelled = true;
    };
  }, [card, attempt]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!printings || !q) return printings ?? [];
    return printings.filter(
      (p) => p.set_name.toLowerCase().includes(q) || p.set.toLowerCase().includes(q)
    );
  }, [printings, query]);

  return (
    <>
      <div className="modal-header scanner-sheet-head">
        <button
          type="button"
          className="scanner-back"
          onClick={onBack}
          aria-label="Back to the card"
        >
          <ChevronLeft width={20} height={20} strokeWidth={2} />
        </button>
        <div className="scanner-sheet-heading">
          <h2 id="scanner-edit-title">Choose a printing</h2>
          <span className="scanner-sheet-sub">
            {printings
              ? `${printings.length} printing${printings.length === 1 ? '' : 's'} of ${card.name}`
              : card.name}
          </span>
        </div>
      </div>
      {printings && printings.length > 6 && (
        <div className="scanner-sheet-tools">
          <SearchPill
            className="scanner-sheet-filter"
            inputType="text"
            placeholder="Search sets"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setShown(PRINTINGS_PAGE);
            }}
            ariaLabel="Search the printings by set"
          />
        </div>
      )}
      <div className="modal-body scanner-sheet-body">
        {error ? (
          <div className="scanner-sheet-empty" role="alert">
            <p className="scanner-sheet-empty-hint">{error}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setError(null);
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : !printings ? (
          <ul className="scan-printings" aria-busy="true" aria-label="Loading printings">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="scan-printing is-loading" aria-hidden>
                <span className="scan-printing-art" />
              </li>
            ))}
          </ul>
        ) : matches.length === 0 ? (
          <p className="scanner-sheet-none">No printings match “{query.trim()}”.</p>
        ) : (
          <>
            <ul className="scan-printings">
              {matches.slice(0, shown).map((p) => {
                const art = p.image_uris?.normal || p.card_faces?.[0]?.image_uris?.normal;
                const current = p.id === card.id;
                const price = finishUnitPrice(p.prices, 'nonfoil');
                return (
                  <li key={p.id} className={`scan-printing${current ? ' is-current' : ''}`}>
                    <button
                      type="button"
                      onClick={() => onPick(p)}
                      aria-label={`${p.set_name} number ${p.collector_number}${current ? ', current' : ''}`}
                      aria-current={current || undefined}
                    >
                      <span className="scan-printing-art">
                        {art ? (
                          <img src={art} alt="" loading="lazy" />
                        ) : (
                          <span>{p.set.toUpperCase()}</span>
                        )}
                      </span>
                      <span className="scan-printing-cap">
                        {p.set_name} ({p.set.toUpperCase()}) #{p.collector_number}
                        <small>{price != null ? formatMoney(price) : 'No price'}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {matches.length > shown && (
              <button
                type="button"
                className="btn scanner-more"
                onClick={() => setShown((n) => n + PRINTINGS_PAGE)}
              >
                Show more ({matches.length - shown})
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
