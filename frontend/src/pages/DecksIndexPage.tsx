import {
  AlignJustify,
  CircleAlert,
  Download,
  LayoutGrid,
  List as ListIconLucide,
  MoreVertical,
  Plus,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDecksStore } from '../store/decks';
import { formatRelativeTime } from '../lib/format-time';
import { ImportDeckDialog } from '../components/deck/ImportDeckDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SelectMenu, type SelectOption } from '../components/SelectMenu';
import { SortDirArrow } from '../components/SortDirArrow';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SearchPill } from '../components/SearchPill';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { getCardPrice } from '../deck-builder/services/scryfall/client';
import type { Deck } from '../store/decks';
import type { ScryfallCard } from '../deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '../deck-builder/lib/constants/archetypes';
import {
  effectiveDeckColors,
  deckColorFrequency,
  validateDeck,
  countFlaggedCards,
} from '../lib/deck-validation';

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

type DeckSortField = 'edited' | 'created' | 'name' | 'commander' | 'cards' | 'value';
type SortDir = 'asc' | 'desc';

const DECK_SORT_OPTIONS: SelectOption<DeckSortField>[] = [
  { value: 'edited', label: 'Date edited' },
  { value: 'created', label: 'Date created' },
  { value: 'name', label: 'Name' },
  { value: 'commander', label: 'Commander' },
  { value: 'cards', label: 'Card count' },
  { value: 'value', label: 'Value' },
];

const DECK_SORT_DEFAULT_DIR: Record<DeckSortField, SortDir> = {
  edited: 'desc',
  created: 'desc',
  name: 'asc',
  commander: 'asc',
  cards: 'desc',
  value: 'desc',
};

function cardPrice(card: ScryfallCard): number {
  const raw = getCardPrice(card, 'USD');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function deckValue(deck: Deck): number {
  let total = 0;
  if (deck.commander) total += cardPrice(deck.commander);
  if (deck.partnerCommander) total += cardPrice(deck.partnerCommander);
  for (const dc of deck.cards) total += cardPrice(dc.card);
  return total;
}

const STORAGE_KEY = 'decks-index-sort';
const VIEW_KEY = 'mtg-decks-view-mode';

type DecksViewMode = 'grid' | 'list' | 'compact';

function readStoredView(): DecksViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'grid' || v === 'list' || v === 'compact') return v;
  } catch {
    /* ignore */
  }
  return 'grid';
}

function loadSort(): { field: DeckSortField; dir: SortDir } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.field in DECK_SORT_DEFAULT_DIR) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { field: 'edited', dir: 'desc' };
}

function deckSortValue(deck: Deck, field: DeckSortField): number | string {
  switch (field) {
    case 'edited':
      return deck.updatedAt;
    case 'created':
      return deck.createdAt;
    case 'name':
      return deck.name.toLowerCase();
    case 'commander':
      return (deck.commander?.name ?? '').toLowerCase();
    case 'cards':
      return (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0) + deck.cards.length;
    case 'value':
      return deckValue(deck);
  }
}

export function DecksIndexPage() {
  const decks = useDecksStore((s) => s.decks);
  const deleteDeck = useDecksStore((s) => s.deleteDeck);
  const deleteAllDecks = useDecksStore((s) => s.deleteAllDecks);
  const navigate = useNavigate();

  const [sortField, setSortField] = useState<DeckSortField>(loadSort().field);
  const [sortDir, setSortDir] = useState<SortDir>(loadSort().dir);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  const [view, setViewRaw] = useState<DecksViewMode>(readStoredView);
  const setView = (v: DecksViewMode) => {
    setViewRaw(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const persistSort = useCallback((field: DeckSortField, dir: SortDir) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ field, dir }));
  }, []);

  // Combined sort pill: clicking the active field flips direction;
  // clicking a different field switches to it with its default direction.
  // Mirrors the collection page so the gesture is consistent app-wide.
  const toggleSort = useCallback(
    (field: DeckSortField) => {
      if (field === sortField) {
        setSortDir((prev) => {
          const next = prev === 'asc' ? 'desc' : 'asc';
          persistSort(sortField, next);
          return next;
        });
      } else {
        const dir = DECK_SORT_DEFAULT_DIR[field];
        setSortField(field);
        setSortDir(dir);
        persistSort(field, dir);
      }
    },
    [sortField, persistSort]
  );

  const sorted = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const filtered = q
      ? decks.filter(
          (d) =>
            d.name.toLowerCase().includes(q) ||
            (d.commander?.name ?? '').toLowerCase().includes(q) ||
            (d.partnerCommander?.name ?? '').toLowerCase().includes(q)
        )
      : decks;
    return [...filtered].sort((a, b) => {
      const va = deckSortValue(a, sortField);
      const vb = deckSortValue(b, sortField);
      if (va < vb) return sortDir === 'desc' ? 1 : -1;
      if (va > vb) return sortDir === 'desc' ? -1 : 1;
      return 0;
    });
  }, [decks, sortField, sortDir, debouncedSearch]);

  const [showImport, setShowImport] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Deck | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

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

  const confirmDeleteAllDecks = () => {
    deleteAllDecks();
    setConfirmDeleteAll(false);
  };

  return (
    <div className="decks-index-page">
      <header className="binder-hero decks-index-hero">
        <div className="decks-index-hero-text">
          <h1 className="binder-hero-name">Decks</h1>
          <p className="binder-hero-meta">
            {sorted.length.toLocaleString()} {sorted.length === 1 ? 'deck' : 'decks'}
          </p>
        </div>
        <div className="decks-index-actions">
          <button
            type="button"
            className="pill-btn"
            aria-haspopup="dialog"
            onClick={() => setShowImport(true)}
          >
            <Download width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>Import deck</span>
          </button>
          <Link to="/decks/new" className="pill-btn pill-btn-primary">
            <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>New deck</span>
          </Link>
        </div>
      </header>

      {decks.length > 0 && (
        <div className="decks-index-search-row">
          <SearchPill
            value={search}
            onChange={setSearch}
            placeholder="Search decks"
            ariaLabel="Search decks"
          />
        </div>
      )}

      {decks.length > 0 && (
        <div className="decks-index-sort-bar">
          {decks.length > 1 && (
            <SelectMenu
              value={sortField}
              options={DECK_SORT_OPTIONS}
              onChange={toggleSort}
              ariaLabel="Sort decks by"
              closeOnSelect={false}
              leadingIcon={<SortDirArrow dir={sortDir} />}
              renderItemPrefix={(_opt, active) => (active ? <SortDirArrow dir={sortDir} /> : null)}
            />
          )}
          <ViewModeToggle<DecksViewMode>
            ariaLabel="Decks view mode"
            className="decks-index-viewmode"
            value={view}
            onChange={setView}
            options={[
              {
                value: 'grid',
                label: 'Grid view',
                icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'list',
                label: 'List view',
                icon: <ListIconLucide width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'compact',
                label: 'Compact list (text only)',
                icon: <AlignJustify width={14} height={14} strokeWidth={2} aria-hidden />,
              },
            ]}
          />
        </div>
      )}

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

      {confirmDeleteAll && (
        <ConfirmDialog
          title={`Delete all ${decks.length} decks?`}
          body="Every deck will be permanently removed. Your collection and binders are unaffected. This cannot be undone."
          confirmLabel="Delete all decks"
          danger
          onConfirm={confirmDeleteAllDecks}
          onCancel={() => setConfirmDeleteAll(false)}
        />
      )}

      {decks.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">No decks yet.</p>
          <div className="empty-state-actions">
            <Link to="/decks/new" className="btn btn-primary">
              Build your first deck
            </Link>
          </div>
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">No decks match "{debouncedSearch}".</p>
        </div>
      ) : (
        <ul className={`decks-index-list is-${view}`}>
          {sorted.map((deck) => {
            const totalCards =
              (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0) + deck.cards.length;
            const art =
              deck.commander?.image_uris?.art_crop ??
              deck.commander?.card_faces?.[0]?.image_uris?.art_crop;
            const colors = effectiveDeckColors(deck);
            // For non-commander decks sort by how often each color shows up in
            // the cards; commander decks fall through to WUBRG order since
            // every color in the identity is "equally used" from a pip
            // perspective.
            const freq = deck.commander || deck.partnerCommander ? null : deckColorFrequency(deck);
            const colorIdentity = Array.from(colors).sort((a, b) => {
              if (freq) {
                const diff = (freq.get(b) ?? 0) - (freq.get(a) ?? 0);
                if (diff !== 0) return diff;
              }
              return (
                COLOR_ORDER.indexOf(a as (typeof COLOR_ORDER)[number]) -
                COLOR_ORDER.indexOf(b as (typeof COLOR_ORDER)[number])
              );
            });
            const themes = deck.generationContext?.selectedThemes ?? [];
            const formatCfg = DECK_FORMAT_CONFIGS[deck.format];
            const issues = formatCfg
              ? validateDeck(deck.cards, deck.sideboard, formatCfg, {
                  commander: deck.commander,
                  partnerCommander: deck.partnerCommander,
                })
              : [];
            const flaggedCount = countFlaggedCards(issues);
            return (
              <li
                key={deck.id}
                className="decks-index-card"
                /* `--deck-color` drives both the resting left-border accent
                   and the full hover-border tint via CSS. */
                style={{ ['--deck-color' as string]: deck.color }}
              >
                <Link to={`/decks/${deck.id}`} className="decks-index-card-link">
                  {view !== 'compact' && art && (
                    <img className="decks-index-card-art" src={art} alt="" aria-hidden="true" />
                  )}
                  <div className="decks-index-card-body">
                    <div className="decks-index-card-name">
                      <span>{deck.name}</span>
                      {flaggedCount > 0 && (
                        <span
                          className="decks-index-card-issues"
                          title={`${flaggedCount} card${
                            flaggedCount === 1 ? '' : 's'
                          } flagged in ${formatCfg?.label ?? deck.format}:\n${issues
                            .slice(0, 5)
                            .map((i) => `• ${i.cardName}: ${i.detail}`)
                            .join(
                              '\n'
                            )}${issues.length > 5 ? `\n…and ${issues.length - 5} more` : ''}`}
                          aria-label={`${flaggedCount} card${
                            flaggedCount === 1 ? '' : 's'
                          } flagged`}
                        >
                          <CircleAlert width={18} height={18} strokeWidth={1.6} aria-hidden />
                        </span>
                      )}
                    </div>
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
                      <span className="deck-format-badge">
                        {DECK_FORMAT_CONFIGS[deck.format]?.label ?? 'Commander'}
                      </span>
                      <span>
                        {deck.commander ? `${deck.commander.name} · ` : ''}
                        {totalCards} cards · {deck.source === 'generated' ? 'Generated' : 'Manual'}
                      </span>
                    </div>
                    {view !== 'compact' && themes.length > 0 && (
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

      {decks.length > 1 && (
        <div className="decks-index-danger">
          <button
            type="button"
            className="btn-link decks-index-danger-btn"
            onClick={() => setConfirmDeleteAll(true)}
          >
            Delete all decks
          </button>
        </div>
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
        <MoreVertical width={18} height={18} strokeWidth={2.2} aria-hidden />
      </button>
      {open && (
        <div className="decks-index-card-menu-panel" role="menu">
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
      )}
    </div>
  );
}
