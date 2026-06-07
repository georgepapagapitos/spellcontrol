import { type JSX, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { LayoutGrid, Rows3 } from 'lucide-react';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useSwipeDownDismiss } from '../../lib/use-swipe-down-dismiss';
import { useSheetExit } from '../../lib/use-sheet-exit';
import { getCardImageUrl } from '@/deck-builder/services/scryfall/client';
import type { CardTally } from './useCardCarousel';
import './CardGroupSheet.css';

type GroupLayout = 'grid' | 'list';

/** Remember the grid/list choice across opens (and surfaces). */
const LAYOUT_KEY = 'sc-cardgroup-layout';
function readLayout(): GroupLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/**
 * The "grouped card overview" sheet — the deck-analysis drill-down's middle step.
 *
 * The carousel answers "what *is* this card?" one-at-a-time; this sheet answers
 * the question it can't — "what's in this *group*, all at once?" A Stats-tab
 * breakdown (mana curve / card type / color) hands it the bucket's cards; the
 * sheet shows them as a grid or scannable list (toggle persisted across opens
 * and surfaces), and a tapped card hands off via `onPick` to the existing
 * carousel for the detail read. Mobile-first bottom-sheet, centered panel ≥600px.
 *
 * Shared primitive: every consumer supplies a `title` + a `CardTally[]` and wires
 * `onPick` to its own `useCardCarousel`; all the layout/toggle lives here.
 */
export function CardGroupSheet({
  title,
  subtitle,
  tally,
  onPick,
  onClose,
}: {
  title: string;
  subtitle?: string;
  tally: CardTally[];
  /** Tapped one card → hand off to the carousel for the detail read. */
  onPick: (picked: CardTally) => void;
  onClose: () => void;
}): JSX.Element {
  const labelId = useId();
  const [layout, setLayout] = useState<GroupLayout>(readLayout);
  const sheetRef = useRef<HTMLElement>(null);
  const scrollBodyRef = useRef<HTMLUListElement>(null);
  useLockBodyScroll();

  // Symmetric slide-down exit so every dismiss path (✕, Escape, backdrop,
  // swipe) plays `sheet-fall` and continues from the finger's release offset
  // instead of vanishing — same contract as the CardPreview carousel.
  const { isClosing, beginClose, onAnimationEnd, exitStyle } = useSheetExit(onClose);

  // Swipe-down-to-dismiss. The gesture spans the whole sheet but is GATED to
  // when the grid/list body is scrolled to the top (iOS-style): short buckets
  // (no scroll) dismiss from anywhere, long ones scroll first, then dismiss —
  // so the swipe never fights the body's native vertical scroll.
  const { isDragging, touchHandlers } = useSwipeDownDismiss({
    onDismiss: beginClose,
    sheetRef,
    canStartDrag: () => (scrollBodyRef.current?.scrollTop ?? 0) <= 0,
  });

  // Snap-back: when a drag releases short of dismissal, clear the imperative
  // inline transform so the `:not(.is-dragging)` CSS transition animates the
  // sheet home. A real dismiss leaves the transform for `sheet-fall` to take over.
  useLayoutEffect(() => {
    if (isDragging || isClosing) return;
    const sheet = sheetRef.current;
    if (sheet) sheet.style.transform = '';
  }, [isDragging, isClosing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') beginClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [beginClose]);

  const chooseLayout = (next: GroupLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // non-fatal — preference just won't persist this session
    }
  };

  const totalCards = tally.reduce((n, t) => n + t.count, 0);

  return (
    <div
      className={`card-group-backdrop${isClosing ? ' is-closing' : ''}`}
      onClick={() => beginClose()}
    >
      <section
        ref={sheetRef}
        className={`card-group-sheet${isDragging ? ' is-dragging' : ''}${
          isClosing ? ' is-closing' : ''
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        style={exitStyle}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
        {...touchHandlers}
      >
        <header className="card-group-head">
          {/* Affordance for swipe-to-dismiss (touch only; hidden ≥600px). */}
          <span className="card-group-handle" aria-hidden="true" />
          <div className="card-group-head-meta">
            <h3 id={labelId} className="card-group-title">
              {title}
            </h3>
            <span className="card-group-sub">
              {subtitle ? `${subtitle} · ` : ''}
              {totalCards} {totalCards === 1 ? 'card' : 'cards'}
            </span>
          </div>
          <div className="card-group-head-actions">
            <div className="card-group-layout-toggle" role="radiogroup" aria-label="Card layout">
              <button
                type="button"
                className="card-group-layout-btn"
                role="radio"
                aria-checked={layout === 'grid'}
                aria-label="Grid view"
                onClick={() => chooseLayout('grid')}
              >
                <LayoutGrid size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="card-group-layout-btn"
                role="radio"
                aria-checked={layout === 'list'}
                aria-label="List view"
                onClick={() => chooseLayout('list')}
              >
                <Rows3 size={16} aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              className="card-group-close"
              onClick={() => beginClose()}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        {layout === 'grid' ? (
          <ul className="card-group-grid" aria-label={title} ref={scrollBodyRef}>
            {tally.map((t) => (
              <li key={t.name} className="card-group-cell">
                <button
                  type="button"
                  className="card-group-card"
                  onClick={() => onPick(t)}
                  aria-label={`Inspect ${t.name}${t.count > 1 ? ` (${t.count} copies)` : ''}`}
                >
                  {t.card ? (
                    <img
                      className="card-group-img"
                      src={getCardImageUrl(t.card, 'normal')}
                      alt={t.name}
                      loading="lazy"
                    />
                  ) : (
                    <span className="card-group-img card-group-img-fallback">{t.name}</span>
                  )}
                  {t.count > 1 && <span className="card-group-qty">×{t.count}</span>}
                  <span className="card-group-name">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="card-group-list" aria-label={title} ref={scrollBodyRef}>
            {tally.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  className="card-group-row"
                  onClick={() => onPick(t)}
                  aria-label={`Inspect ${t.name}${t.count > 1 ? ` (${t.count} copies)` : ''}`}
                >
                  {t.card ? (
                    <img
                      className="card-group-row-thumb"
                      src={getCardImageUrl(t.card, 'small')}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="card-group-row-thumb" aria-hidden="true" />
                  )}
                  <span className="card-group-row-meta">
                    <span className="card-group-row-name">{t.name}</span>
                    {t.card?.type_line && (
                      <span className="card-group-row-type">{t.card.type_line}</span>
                    )}
                  </span>
                  {t.count > 1 && <span className="card-group-row-qty">×{t.count}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
