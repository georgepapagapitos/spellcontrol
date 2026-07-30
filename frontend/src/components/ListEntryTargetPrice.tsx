import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ListEntry } from '../types';
import { parseTargetPrice } from '../lib/lists';
import { formatMoney } from '../lib/format-money';
import { currencySymbol, getCurrency } from '../lib/currency';

interface Props {
  entry: ListEntry;
  /** Persists via the caller's `updateListEntry` mutator — same path every
   *  other ListEntry field patches through. `undefined` for both fields
   *  clears the target back to absent (never stored as 0). */
  onSave: (patch: { targetPrice: number | undefined; currency: 'USD' | 'EUR' | undefined }) => void;
}

/**
 * Inline target-price editor for a list row (E163). Sits directly on the
 * row where the price already renders for other surfaces — no detail sheet.
 * Reads as a quiet chip when unset/set, becomes a text input on activation.
 * Existing values render in the currency they were entered in
 * (`entry.currency ?? 'USD'`, never re-labeled to the viewer's active
 * currency — see `ListEntry.currency`); a freshly typed value is stamped
 * with the *active* display currency, matching every other "set alongside
 * targetPrice" callsite in the store.
 */
export function ListEntryTargetPrice({ entry, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Guards the clear button's dual mousedown/click handling (see below) so a
  // pointer clear fires onSave exactly once.
  const clearedRef = useRef(false);

  const startEditing = () => {
    setDraft(entry.targetPrice !== undefined ? String(entry.targetPrice) : '');
    clearedRef.current = false;
    setEditing(true);
  };

  const clearTarget = () => {
    if (clearedRef.current) return;
    clearedRef.current = true;
    onSave({ targetPrice: undefined, currency: undefined });
    setEditing(false);
  };

  const commit = () => {
    const parsed = parseTargetPrice(draft);
    if (parsed === undefined) {
      // Reject: invalid/negative/garbage input never overwrites a stored
      // value (or introduces a bogus one) — just close back to the
      // previous state.
      setEditing(false);
      return;
    }
    if (parsed === null) {
      onSave({ targetPrice: undefined, currency: undefined });
    } else {
      onSave({ targetPrice: parsed, currency: getCurrency() });
    }
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  // The row this sits in has its own onClick (opens the card preview) — every
  // interactive element here must stop propagation or a tap on the price
  // chip / input would also fire the row's activation.
  if (editing) {
    return (
      <div
        className="list-target-price is-editing"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <label className="sr-only" htmlFor={`target-price-${entry.id}`}>
          Target price for {entry.name}, in {getCurrency()}
        </label>
        <span className="list-target-price-symbol" aria-hidden>
          {currencySymbol()}
        </span>
        <input
          ref={inputRef}
          id={`target-price-${entry.id}`}
          type="text"
          inputMode="decimal"
          className="list-target-price-input"
          value={draft}
          placeholder="0.00"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        />
        {entry.targetPrice !== undefined && (
          <button
            type="button"
            className="list-target-price-clear"
            aria-label={`Clear target price for ${entry.name}`}
            // Pointer: mousedown fires before the input's blur-commit, so
            // clearing doesn't race a blur-triggered re-parse of the draft.
            // Keyboard: Enter/Space emit only `click`, never `mousedown` — so
            // click is wired too or the button is unreachable without a mouse.
            // `clearTarget` is idempotent per edit session, so the pointer
            // path can't double-fire onSave.
            onMouseDown={(e) => {
              e.preventDefault();
              clearTarget();
            }}
            onClick={(e) => {
              e.stopPropagation();
              clearTarget();
            }}
          >
            <X width={13} height={13} strokeWidth={2.5} aria-hidden />
          </button>
        )}
      </div>
    );
  }

  if (entry.targetPrice === undefined) {
    return (
      <button
        type="button"
        className="list-target-price list-target-price-empty"
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={`Set target price for ${entry.name}`}
      >
        + Target
      </button>
    );
  }

  return (
    <button
      type="button"
      className="list-target-price list-target-price-set"
      onClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={`Target price ${formatMoney(entry.targetPrice, {
        currency: entry.currency ?? 'USD',
      })} for ${entry.name}. Edit.`}
    >
      {formatMoney(entry.targetPrice, { currency: entry.currency ?? 'USD' })}
    </button>
  );
}
