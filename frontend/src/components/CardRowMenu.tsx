import { MoreVertical, Notebook, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AddToBinderSheet } from './AddToBinderSheet';
import type { EnrichedCard } from '../types';

interface Props {
  card: EnrichedCard;
  onEditCard: () => void;
  /** The binder this card is currently routed to, if any. Drives the
   *  "Move to binder" vs "Add to binder" label and the disabled row in the
   *  sheet. */
  currentBinder?: { id: string; name: string; color: string | null } | null;
}

export function CardRowMenu({ card, onEditCard, currentBinder }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [binderSheetOpen, setBinderSheetOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <>
      <div className="deck-row-menu" ref={menuRef}>
        <button
          type="button"
          className="card-edit-btn"
          aria-label="Card actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-open={menuOpen || undefined}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreVertical width={14} height={14} strokeWidth={2} aria-hidden />
        </button>
        {menuOpen && (
          <div role="menu" className="deck-row-menu-popover">
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
          </div>
        )}
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
