import { MoreVertical, Notebook, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AddToBinderSheet } from './AddToBinderSheet';
import type { EnrichedCard } from '../types';

interface Props {
  card: EnrichedCard;
  onEditCard: () => void;
  /** Remove this row's copies from the collection. Omit to hide the action. */
  onDelete?: () => void;
  /** The binder this card is currently routed to, if any. Drives the
   *  "Move to binder" vs "Add to binder" label and the disabled row in the
   *  sheet. */
  currentBinder?: { id: string; name: string; color: string | null } | null;
}

type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

export function CardRowMenu({ card, onEditCard, onDelete, currentBinder }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [binderSheetOpen, setBinderSheetOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The list is window-virtualized: each row is its own stacking context, so
  // an absolutely-positioned popover gets painted under later rows (clicks
  // land on the row behind). Portal to <body> with fixed positioning to
  // escape every row's stacking context. Same approach as SelectMenu.
  useLayoutEffect(() => {
    if (!menuOpen || !panelRef.current || !buttonRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const triggerRect = buttonRef.current.getBoundingClientRect();
    setPanelPos((p) => {
      if (!p) return p;
      let next = p;
      if (p.top !== undefined && rect.bottom > window.innerHeight) {
        next = { ...next, top: undefined, bottom: window.innerHeight - triggerRect.top + 6 };
      }
      if (next.bottom !== undefined) {
        const upwardTop = triggerRect.top - 6 - rect.height;
        if (upwardTop < 8) next = { ...next, top: 8, bottom: undefined };
      }
      if (rect.left < 8) {
        next = { ...next, right: undefined, left: Math.max(8, triggerRect.left) };
      }
      return next === p ? p : next;
    });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node) &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      )
        setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    // Close if the row scrolls (the fixed panel would otherwise detach from
    // its trigger). Delayed a frame so the opening click's micro-scroll
    // doesn't immediately close it.
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && panelRef.current && panelRef.current.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    const scrollRaf = requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    });
    return () => {
      cancelAnimationFrame(scrollRaf);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [menuOpen]);

  const handleToggle = () => {
    if (!menuOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const right = Math.max(0, window.innerWidth - rect.right);
      setPanelPos(
        spaceBelow >= 160
          ? { top: rect.bottom + 6, right }
          : { bottom: window.innerHeight - rect.top + 6, right }
      );
    }
    setMenuOpen((v) => !v);
  };

  const panel =
    menuOpen &&
    panelPos &&
    createPortal(
      <div
        ref={panelRef}
        role="menu"
        className="deck-row-menu-popover"
        style={{
          position: 'fixed',
          left: panelPos.left,
          right: panelPos.right,
          top: panelPos.top,
          bottom: panelPos.bottom,
          margin: 0,
          zIndex: 1200,
        }}
      >
        {currentBinder && (
          <div className="deck-row-menu-status" aria-live="polite">
            <span
              className="card-list-binder-badge-swatch"
              style={{ background: currentBinder.color || 'var(--accent)' }}
              aria-hidden
            />
            <span>
              In <strong>{currentBinder.name}</strong>
            </span>
          </div>
        )}
        <button
          type="button"
          role="menuitem"
          className="deck-row-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(false);
            onEditCard();
          }}
        >
          <Pencil width={12} height={12} strokeWidth={1.6} aria-hidden />
          Edit card
        </button>
        <button
          type="button"
          role="menuitem"
          className="deck-row-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(false);
            setBinderSheetOpen(true);
          }}
        >
          <Notebook width={12} height={12} strokeWidth={1.6} aria-hidden />
          {currentBinder ? 'Move to binder' : 'Add to binder'}
        </button>
        {onDelete && (
          <button
            type="button"
            role="menuitem"
            className="deck-row-menu-item deck-row-menu-item--danger"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onDelete();
            }}
          >
            <Trash2 width={12} height={12} strokeWidth={1.6} aria-hidden />
            Remove from collection
          </button>
        )}
      </div>,
      document.body
    );

  return (
    <>
      <div className="deck-row-menu" ref={wrapperRef}>
        <button
          ref={buttonRef}
          type="button"
          className="card-edit-btn"
          aria-label="Card actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-open={menuOpen || undefined}
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
        >
          <MoreVertical width={14} height={14} strokeWidth={2} aria-hidden />
        </button>
        {panel}
      </div>

      {binderSheetOpen && (
        <AddToBinderSheet
          card={card}
          currentBinderId={currentBinder?.id ?? null}
          onClose={() => setBinderSheetOpen(false)}
        />
      )}
    </>
  );
}
