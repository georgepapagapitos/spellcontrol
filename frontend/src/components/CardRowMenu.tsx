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
          <DotsIcon />
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
              <EditIcon />
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
              <BinderIcon />
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

function DotsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11.3 2.7l2 2L5 13H3v-2l8.3-8.3z" />
    </svg>
  );
}

function BinderIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M6 2v12" />
    </svg>
  );
}
