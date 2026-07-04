import { useEffect, useMemo, useState } from 'react';
import { fetchPrintings } from '../lib/api';
import { formatMoney } from '../lib/format-money';
import { availableFinishes } from '../lib/scanner-feedback';
import { SelectMenu, type SelectOption } from './SelectMenu';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Condition, Finish } from '../types';

const PRINTING_PAGE_SIZE = 8;

export const FINISH_LABEL: Record<Finish, string> = {
  nonfoil: 'Non-foil',
  foil: 'Foil',
  etched: 'Etched',
};

/** Per-copy inventory details chosen at add time. */
export interface AddExtras {
  quantity: number;
  condition?: Condition;
  language?: string;
}

/** '' means "not set" — the field is left off the stored copy. */
export const CONDITION_OPTIONS: SelectOption<string>[] = [
  { value: '', label: 'Not set' },
  { value: 'nm', label: 'Near Mint' },
  { value: 'lp', label: 'Lightly Played' },
  { value: 'mp', label: 'Moderately Played' },
  { value: 'hp', label: 'Heavily Played' },
  { value: 'damaged', label: 'Damaged' },
];

/** Scryfall printed-language codes. '' means "not set". */
export const LANGUAGE_OPTIONS: SelectOption<string>[] = [
  { value: '', label: 'Not set' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ru', label: 'Russian' },
  { value: 'zhs', label: 'Chinese (Simplified)' },
  { value: 'zht', label: 'Chinese (Traditional)' },
  { value: 'ph', label: 'Phyrexian' },
];

function priceForFinish(card: ScryfallCard, finish: Finish): number {
  const p = card.prices;
  if (!p) return 0;
  const raw = finish === 'foil' ? p.usd_foil : finish === 'etched' ? p.usd_etched : p.usd;
  return raw ? Number(raw) || 0 : 0;
}

interface Props {
  cardName: string;
  /** The printing already on screen — instant selection while the full list loads. */
  fallback: ScryfallCard;
  /**
   * Show the collection-inventory extras (quantity stepper + condition +
   * language) in the add bar. On for surfaces that create physical copies;
   * off when the add targets something without per-copy details (list entries).
   */
  showExtras?: boolean;
  onAdd: (printing: ScryfallCard, finish: Finish, extras: AddExtras) => void;
}

/**
 * Lazy-loading printing + finish picker with an explicit "Add …" bar, shared
 * by every search-and-add surface (collection Add-cards sheet, binder
 * quick-add, inline collection search, list search). Lives in its own file so
 * the sheets don't each grow a divergent copy; keeps the `inline-card-search-*`
 * class names its styles were born under (binder-card-management.css).
 */
export function PrintingPicker({ cardName, fallback, showExtras = false, onAdd }: Props) {
  const [printings, setPrintings] = useState<ScryfallCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(fallback.id);
  const [finish, setFinish] = useState<Finish>('nonfoil');
  const [pVisible, setPVisible] = useState(PRINTING_PAGE_SIZE);
  const [qty, setQty] = useState(1);
  const [condition, setCondition] = useState('');
  const [language, setLanguage] = useState('');

  // cardName is fixed for this picker's lifetime (a different row mounts a
  // fresh picker), so the initial loading/error state is correct and we
  // never need to reset synchronously inside the effect.
  useEffect(() => {
    let cancelled = false;
    fetchPrintings(cardName)
      .then((ps) => {
        if (cancelled) return;
        const list = ps.length > 0 ? ps : [fallback];
        setPrintings(list);
        setSelectedId(list.some((p) => p.id === fallback.id) ? fallback.id : list[0].id);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't load printings");
        setPrintings([fallback]);
        setSelectedId(fallback.id);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardName, fallback]);

  const selected = printings?.find((p) => p.id === selectedId) ?? null;
  const finishes = useMemo<Finish[]>(
    () => (selected ? availableFinishes(selected.finishes) : ['nonfoil']),
    [selected]
  );
  // The user's explicit pick may not exist on a newly selected printing —
  // fall back to its first finish without an effect (no flicker, no
  // set-state-in-effect).
  const effectiveFinish: Finish = finishes.includes(finish) ? finish : finishes[0];

  const handleAdd = () => {
    if (!selected) return;
    onAdd(selected, effectiveFinish, {
      quantity: qty,
      ...(condition ? { condition: condition as Condition } : {}),
      ...(language ? { language } : {}),
    });
    // Quantity resets so a follow-up tap can't silently re-add a whole stack;
    // condition/language stay sticky for entering a played playset in one go.
    setQty(1);
  };

  return (
    <div className="inline-card-search-printings">
      {loading && <p className="inline-card-search-status">Loading printings…</p>}
      {error && <p className="inline-card-search-status inline-card-search-error">{error}</p>}
      {printings && (
        <>
          <ul className="inline-card-search-printing-list" role="listbox" aria-label="Printings">
            {printings.slice(0, pVisible).map((p) => {
              const isSel = p.id === selectedId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    className={`inline-card-search-printing${isSel ? ' is-selected' : ''}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className="inline-card-search-printing-set">
                      {p.set.toUpperCase()} #{p.collector_number}
                    </span>
                    <span className="inline-card-search-printing-set-name">{p.set_name}</span>
                    <span className="inline-card-search-printing-price">
                      {formatMoney(priceForFinish(p, 'nonfoil') || priceForFinish(p, 'foil'), {
                        zeroAsDash: true,
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {printings.length > pVisible && (
            <button
              type="button"
              className="inline-card-search-more inline-card-search-more--printings"
              onClick={() => setPVisible((v) => v + PRINTING_PAGE_SIZE)}
            >
              Show {Math.min(PRINTING_PAGE_SIZE, printings.length - pVisible)} more printings
            </button>
          )}
          {selected && showExtras && (
            <div className="inline-card-search-extras">
              <div className="card-edit-qty-controls">
                <button
                  type="button"
                  className="card-edit-qty-btn"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input
                  type="number"
                  className="card-edit-qty-input inline-card-search-qty-input"
                  min={1}
                  max={99}
                  value={qty}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    if (Number.isFinite(n)) setQty(Math.max(1, Math.min(99, n)));
                  }}
                  aria-label="Quantity to add"
                />
                <button
                  type="button"
                  className="card-edit-qty-btn"
                  onClick={() => setQty((q) => Math.min(99, q + 1))}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <SelectMenu
                label="Condition"
                value={condition}
                options={CONDITION_OPTIONS}
                onChange={setCondition}
              />
              <SelectMenu
                label="Language"
                value={language}
                options={LANGUAGE_OPTIONS}
                onChange={setLanguage}
              />
            </div>
          )}
          {selected && (
            <div className="inline-card-search-finish-bar">
              <div className="inline-card-search-finishes" role="group" aria-label="Finish">
                {finishes.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`inline-card-search-finish${
                      effectiveFinish === f ? ' is-active' : ''
                    }`}
                    aria-pressed={effectiveFinish === f}
                    onClick={() => setFinish(f)}
                  >
                    {FINISH_LABEL[f]}
                  </button>
                ))}
              </div>
              <button type="button" className="inline-card-search-add-printing" onClick={handleAdd}>
                Add {qty > 1 ? `${qty} × ` : ''}
                {selected.set.toUpperCase()} #{selected.collector_number} ·{' '}
                {FINISH_LABEL[effectiveFinish]} ·{' '}
                {formatMoney(priceForFinish(selected, effectiveFinish) * qty, {
                  zeroAsDash: true,
                })}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
