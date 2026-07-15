import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, X } from 'lucide-react';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { useCardThumb } from '@/lib/card-thumbs';
import type { ArrivalRow } from '@/lib/new-arrivals';
import { TYPE_GROUP_PLURAL, type TypeGroup } from '@/lib/build-mana-data';
import { ManaCost } from '../ManaCost';
import './NewArrivalsSheet.css';

interface Props {
  bucket: TypeGroup;
  rows: ArrivalRow[];
  onClose: () => void;
  /** Stamp deck.lastArrivalReviewAt (silent). Fired once, from the real close
   *  path (✕ / backdrop / Escape all route through beginClose -> this). */
  onMarkReviewed: () => void;
  /** Add-by-name — reuses the same handler as the Coach/Build Report lanes. */
  onAddCard?: (name: string) => void;
  addingCardNames?: ReadonlySet<string>;
  /** Exact-case in-deck names (mainboard + sideboard) — live, so a row flips
   *  to "Added" the moment its add lands without the list itself reordering. */
  existingCardCounts?: ReadonlyMap<string, number>;
}

/**
 * Per-category "new arrivals" review sheet (E140) — the tapped panel's
 * owned-since-last-update cards, ranked, with a one-tap Add. Mirrors
 * BuildReportSheet's chrome (portal, backdrop, symmetric exit, mobile bottom
 * sheet / desktop centered panel) rather than inventing a new overlay system.
 */
export function NewArrivalsSheet({
  bucket,
  rows,
  onClose,
  onMarkReviewed,
  onAddCard,
  addingCardNames,
  existingCardCounts,
}: Props): JSX.Element {
  // Frozen at mount: the parent recomputes its live arrivals map the moment
  // onMarkReviewed lands (the window start moves), which would otherwise
  // empty this list out from under an already-open sheet.
  const [frozenRows] = useState(rows);

  // Guard so a StrictMode/HMR remount (or a double-fired exit trigger) can't
  // stamp the review twice.
  const reviewedRef = useRef(false);
  const onCloseAndReview = useCallback(() => {
    if (!reviewedRef.current) {
      reviewedRef.current = true;
      onMarkReviewed();
    }
    onClose();
  }, [onMarkReviewed, onClose]);

  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onCloseAndReview, [
    'sheet-fall',
    'modal-panel-out',
  ]);

  // Minimal focus management (mirrors what a dialog needs beyond BuildReportSheet's
  // plain role/aria-modal): move focus in on open, restore it on close.
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    closeBtnRef.current?.focus();
    return () => {
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus();
    };
  }, []);

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) beginClose();
  };
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') beginClose();
  };

  const label = TYPE_GROUP_PLURAL[bucket];

  return createPortal(
    <div
      className={`new-arrivals-sheet-backdrop${isClosing ? ' is-closing' : ''}`}
      role="presentation"
      onMouseDown={handleBackdrop}
      onKeyDown={handleKey}
    >
      <div
        className={`new-arrivals-sheet${isClosing ? ' is-closing' : ''}`}
        onAnimationEnd={onAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-label={`New arrivals — ${label}`}
      >
        <div className="new-arrivals-sheet-header">
          <div className="new-arrivals-sheet-title-row">
            <div className="new-arrivals-sheet-title-text">
              <h2 className="new-arrivals-sheet-heading">New arrivals — {label}</h2>
              <p className="new-arrivals-sheet-subheading">
                Added to your collection since you last updated this deck.
              </p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              className="new-arrivals-sheet-close"
              aria-label="Close new arrivals"
              onClick={() => beginClose()}
            >
              <X width={18} height={18} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
        <ul className="new-arrivals-sheet-body">
          {frozenRows.map((row) => (
            <ArrivalRowItem
              key={row.name}
              row={row}
              adding={addingCardNames?.has(row.name) ?? false}
              added={(existingCardCounts?.get(row.name) ?? 0) > 0}
              onAdd={onAddCard ? () => onAddCard(row.name) : undefined}
            />
          ))}
        </ul>
      </div>
    </div>,
    document.body
  );
}

function ArrivalRowItem({
  row,
  adding,
  added,
  onAdd,
}: {
  row: ArrivalRow;
  adding: boolean;
  added: boolean;
  onAdd?: () => void;
}): JSX.Element {
  const thumb = useCardThumb(row.name, 'small');
  return (
    <li className="new-arrivals-row">
      <span className="new-arrivals-row-thumb-wrap" aria-hidden>
        {thumb ? (
          <img src={thumb} alt="" className="new-arrivals-row-thumb" loading="lazy" />
        ) : (
          <span className="new-arrivals-row-thumb-ph" />
        )}
      </span>
      <span className="new-arrivals-row-meta">
        <span className="new-arrivals-row-name">{row.name}</span>
        <span className="new-arrivals-row-sub">
          <ManaCost cost={row.card.manaCost} />
          {row.qty > 1 && <span className="new-arrivals-row-qty">×{row.qty} owned</span>}
        </span>
      </span>
      <button
        type="button"
        className={`new-arrivals-row-add${added ? ' is-added' : ''}`}
        onClick={onAdd}
        disabled={!onAdd || adding || added}
        aria-label={added ? `${row.name} added` : `Add ${row.name}`}
      >
        {added ? (
          <>
            <Check width={14} height={14} strokeWidth={2.4} aria-hidden />
            Added
          </>
        ) : (
          <>
            <Plus width={14} height={14} strokeWidth={2.2} aria-hidden />
            {adding ? 'Adding…' : 'Add'}
          </>
        )}
      </button>
    </li>
  );
}
