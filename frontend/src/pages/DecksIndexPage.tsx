import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDecksStore } from '../store/decks';
import { formatRelativeTime } from '../lib/format-time';
import { ImportDeckDialog } from '../components/deck/ImportDeckDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import type { Deck } from '../store/decks';

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

export function DecksIndexPage() {
  const decks = useDecksStore((s) => s.decks);
  const deleteDeck = useDecksStore((s) => s.deleteDeck);
  const navigate = useNavigate();
  const sorted = useMemo(() => [...decks].sort((a, b) => b.updatedAt - a.updatedAt), [decks]);
  const [showImport, setShowImport] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Deck | null>(null);

  const handleRegenerate = (deck: Deck) => {
    if (!deck.commander) return;
    navigate('/decks/new', {
      state: {
        prefill: {
          commander: deck.commander,
          themes: (deck.generationContext?.selectedThemes ?? []).map((t) => ({
            name: t.name,
            slug: t.slug ?? '',
            count: t.deckCount ?? 0,
            url: '',
            popularityPercent: t.popularityPercent,
          })),
          bracketLevel: deck.generationContext?.bracketLevel ?? 'all',
          landCount: deck.generationContext?.landCount ?? 37,
          collectionMode: deck.generationContext?.collectionMode ?? false,
        },
      },
    });
  };

  const handleDelete = (deck: Deck) => {
    setPendingDelete(deck);
  };

  const confirmDelete = () => {
    if (pendingDelete) deleteDeck(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <div className="decks-index-page">
      <header className="binder-hero decks-index-hero">
        <div className="decks-index-hero-text">
          <h1 className="binder-hero-name">Decks</h1>
          <p className="binder-hero-meta">
            {sorted.length.toLocaleString()} {sorted.length === 1 ? 'deck' : 'decks'}
          </p>
          <p className="decks-index-subtitle">
            Saved Commander decks. Build a new one from a commander, generate from EDHREC, or start
            blank and add cards from your collection.
          </p>
        </div>
        <div className="decks-index-actions">
          <button
            type="button"
            className="pill-btn"
            aria-haspopup="dialog"
            onClick={() => setShowImport(true)}
          >
            Import deck
          </button>
          <Link to="/decks/new" className="pill-btn pill-btn-primary">
            + New deck
          </Link>
        </div>
      </header>

      {showImport && <ImportDeckDialog onClose={() => setShowImport(false)} />}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          body="This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">No decks yet.</p>
          <div className="empty-state-actions">
            <Link to="/decks/new" className="btn btn-primary">
              Build your first deck
            </Link>
          </div>
        </div>
      ) : (
        <ul className="decks-index-list">
          {sorted.map((deck) => {
            const totalCards =
              (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0) + deck.cards.length;
            const art =
              deck.commander?.image_uris?.art_crop ??
              deck.commander?.card_faces?.[0]?.image_uris?.art_crop;
            const colorIdentity = (deck.commander?.color_identity ?? [])
              .slice()
              .sort(
                (a, b) =>
                  COLOR_ORDER.indexOf(a as (typeof COLOR_ORDER)[number]) -
                  COLOR_ORDER.indexOf(b as (typeof COLOR_ORDER)[number])
              );
            const themes = deck.generationContext?.selectedThemes ?? [];
            return (
              <li key={deck.id} className="decks-index-card">
                <Link to={`/decks/${deck.id}`} className="decks-index-card-link">
                  {art && (
                    <img className="decks-index-card-art" src={art} alt="" aria-hidden="true" />
                  )}
                  <div className="decks-index-card-body">
                    <div className="decks-index-card-name">{deck.name}</div>
                    <div className="decks-index-card-meta">
                      {colorIdentity.length > 0 && (
                        <span className="decks-index-card-pips" aria-label="Color identity">
                          {colorIdentity.map((c) => (
                            <i
                              key={c}
                              className={`ms ms-${c.toLowerCase()} ms-cost color-pip-mana`}
                              aria-hidden
                            />
                          ))}
                        </span>
                      )}
                      <span>
                        {deck.commander?.name ?? 'No commander'} · {totalCards} cards ·{' '}
                        {deck.source === 'generated' ? 'Generated' : 'Manual'}
                      </span>
                    </div>
                    {themes.length > 0 && (
                      <div className="decks-index-card-themes">
                        {themes.map((t) => (
                          <span key={t.slug ?? t.name} className="decks-index-card-theme-chip">
                            {t.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="decks-index-card-time">
                      Edited {formatRelativeTime(deck.updatedAt)}
                    </div>
                  </div>
                </Link>
                <DeckCardMenu
                  canRegenerate={deck.source === 'generated' && !!deck.commander}
                  onRegenerate={() => handleRegenerate(deck)}
                  onDelete={() => handleDelete(deck)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DeckCardMenu({
  canRegenerate,
  onRegenerate,
  onDelete,
}: {
  canRegenerate: boolean;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Locks page scroll while the sheet is open on mobile (no-op on desktop
  // where the menu is a normal dropdown).
  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="decks-index-card-menu" ref={wrapperRef}>
      <button
        type="button"
        className="decks-index-card-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Deck actions"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <>
          {/* Mobile-only scrim. On desktop the dropdown reads as a normal
              popover; on phone it becomes a full-width bottom sheet. */}
          <div
            className="decks-index-card-menu-backdrop"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
            aria-hidden
          />
          <div className="decks-index-card-menu-panel" role="menu">
            <div className="decks-index-card-menu-handle" aria-hidden />
            {canRegenerate && (
              <button
                type="button"
                role="menuitem"
                className="decks-index-card-menu-item"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  onRegenerate();
                }}
              >
                Re-generate
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="decks-index-card-menu-item decks-index-card-menu-item--danger"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
