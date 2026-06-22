import {
  AlignJustify,
  CircleAlert,
  Download,
  LayoutGrid,
  List as ListIconLucide,
  MoreVertical,
  Package,
  Plus,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStoredSort } from '../lib/use-stored-sort';
import { useStoredView } from '../lib/use-stored-view';
import { Link, useNavigate } from 'react-router-dom';
import { useDecksStore } from '../store/decks';
import { formatRelativeTime } from '../lib/format-time';
import { ImportDeckDialog } from '../components/deck/ImportDeckDialog';
import { ProductSearchDialog } from '../components/ProductSearchDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SelectMenu, type SelectOption } from '../components/SelectMenu';
import { SortDirArrow } from '../components/SortDirArrow';
import { ColorPip } from '../components/shared/ManaSymbol';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SearchPill } from '../components/SearchPill';
import { DeckFiltersPopover } from '../components/DeckFiltersPopover';
import { OverflowMenu } from '../components/OverflowMenu';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { getCardPrice } from '../deck-builder/services/scryfall/client';
import type { Deck, DeckSource } from '../store/decks';
import type { DeckFormat, ScryfallCard } from '../deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '../deck-builder/lib/constants/archetypes';
import {
  effectiveDeckColors,
  deckColorFrequency,
  validateDeck,
  countFlaggedCards,
} from '../lib/deck-validation';
import { ShareDialog } from '../components/ShareDialog';

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

const FILTERS_KEY = 'decks-index-filters';

type StoredFilters = {
  formats: DeckFormat[];
  sources: DeckSource[];
  colors: string[];
};

function loadFilters(): StoredFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredFilters>;
      return {
        formats: Array.isArray(parsed.formats) ? (parsed.formats as DeckFormat[]) : [],
        sources: Array.isArray(parsed.sources) ? (parsed.sources as DeckSource[]) : [],
        colors: Array.isArray(parsed.colors) ? parsed.colors : [],
      };
    }
  } catch {
    /* ignore */
  }
  return { formats: [], sources: [], colors: [] };
}

function persistFilters(formats: Set<DeckFormat>, sources: Set<DeckSource>, colors: Set<string>) {
  try {
    localStorage.setItem(
      FILTERS_KEY,
      JSON.stringify({
        formats: Array.from(formats),
        sources: Array.from(sources),
        colors: Array.from(colors),
      } satisfies StoredFilters)
    );
  } catch {
    /* ignore */
  }
}

type DecksViewMode = 'grid' | 'list' | 'compact';

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

  const { sortField, sortDir, toggleSort } = useStoredSort<DeckSortField>(
    'decks-index-sort',
    DECK_SORT_DEFAULT_DIR,
    'edited'
  );
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  const [formatFilter, setFormatFilterRaw] = useState<Set<DeckFormat>>(
    () => new Set(loadFilters().formats)
  );
  const [sourceFilter, setSourceFilterRaw] = useState<Set<DeckSource>>(
    () => new Set(loadFilters().sources)
  );
  const [colorFilter, setColorFilterRaw] = useState<Set<string>>(
    () => new Set(loadFilters().colors)
  );
  const setFormatFilter = (next: Set<DeckFormat>) => {
    setFormatFilterRaw(next);
    persistFilters(next, sourceFilter, colorFilter);
  };
  const setSourceFilter = (next: Set<DeckSource>) => {
    setSourceFilterRaw(next);
    persistFilters(formatFilter, next, colorFilter);
  };
  const setColorFilter = (next: Set<string>) => {
    setColorFilterRaw(next);
    persistFilters(formatFilter, sourceFilter, next);
  };
  // Combined sort pill: clicking the active field flips direction;
  // clicking a different field switches to it with its default direction.
  // Mirrors the collection page so the gesture is consistent app-wide.
  const [view, setView] = useStoredView<DecksViewMode>(
    'mtg-decks-view-mode',
    ['grid', 'list', 'compact'],
    'grid'
  );

  const sorted = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const hasFormatFilter = formatFilter.size > 0;
    const hasSourceFilter = sourceFilter.size > 0;
    const hasColorFilter = colorFilter.size > 0;
    const filtered = decks.filter((d) => {
      if (q) {
        const matchesSearch =
          d.name.toLowerCase().includes(q) ||
          (d.commander?.name ?? '').toLowerCase().includes(q) ||
          (d.partnerCommander?.name ?? '').toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      if (hasFormatFilter && !formatFilter.has(d.format)) return false;
      if (hasSourceFilter && !sourceFilter.has(d.source)) return false;
      if (hasColorFilter) {
        const deckColors = effectiveDeckColors(d);
        // "C" means colorless — match decks whose effective identity is empty.
        // Any selected color must be present (intersection semantics: picking
        // R + G shows red AND green decks, matching collection-page behavior).
        for (const c of colorFilter) {
          if (c === 'C') {
            if (deckColors.size !== 0) return false;
          } else if (!deckColors.has(c)) {
            return false;
          }
        }
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      const va = deckSortValue(a, sortField);
      const vb = deckSortValue(b, sortField);
      if (va < vb) return sortDir === 'desc' ? 1 : -1;
      if (va > vb) return sortDir === 'desc' ? -1 : 1;
      return 0;
    });
  }, [decks, sortField, sortDir, debouncedSearch, formatFilter, sourceFilter, colorFilter]);

  const [showImport, setShowImport] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Deck | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [shareDeck, setShareDeck] = useState<Deck | null>(null);

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
          targetBracket: deck.generationContext?.targetBracket ?? 'all',
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
          {/* Import + Add a product are secondary: full pills on desktop/tablet,
              collapsed into the ⋮ kebab on phones so the primary "New deck"
              CTA never gets crowded off the row. */}
          <button
            type="button"
            className="pill-btn decks-index-action-secondary"
            aria-haspopup="dialog"
            onClick={() => setShowImport(true)}
          >
            <Download width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>Import deck</span>
          </button>
          <button
            type="button"
            className="pill-btn decks-index-action-secondary"
            aria-haspopup="dialog"
            onClick={() => setShowProductSearch(true)}
          >
            <Package width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>Add a product</span>
          </button>
          <OverflowMenu
            className="decks-index-actions-overflow"
            triggerClassName="pill-btn decks-index-actions-kebab"
            ariaLabel="More deck actions"
            items={[
              { label: 'Import deck', icon: Download, onClick: () => setShowImport(true) },
              { label: 'Add a product', icon: Package, onClick: () => setShowProductSearch(true) },
            ]}
          />
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
            trailing={
              <DeckFiltersPopover
                formats={formatFilter}
                setFormats={setFormatFilter}
                sources={sourceFilter}
                setSources={setSourceFilter}
                colors={colorFilter}
                setColors={setColorFilter}
              />
            }
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
      {showProductSearch && <ProductSearchDialog onClose={() => setShowProductSearch(false)} />}

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
        /* Three-door empty state (UX-317) — mirrors the Binders gold standard:
           a tagline, a plain-English hint, then ALL three entry points so the
           user knows what the page can do before they've done anything. */
        <div className="empty-state">
          <p className="empty-state-tagline">No decks yet.</p>
          <p className="empty-state-hint">
            Build a deck from scratch with the guided builder, import a list you already have, or
            add a known product — a preconstructed deck or Secret Lair drop.
          </p>
          <div className="empty-state-actions decks-empty-actions">
            <Link to="/decks/new/guided" className="btn btn-primary empty-state-action">
              <Wand2 width={14} height={14} strokeWidth={2} aria-hidden />
              Build a deck
            </Link>
            <button
              type="button"
              className="btn empty-state-action"
              onClick={() => setShowImport(true)}
            >
              <Download width={14} height={14} strokeWidth={2} aria-hidden />
              Import deck
            </button>
            <button
              type="button"
              className="btn empty-state-action"
              onClick={() => setShowProductSearch(true)}
            >
              <Package width={14} height={14} strokeWidth={2} aria-hidden />
              Add a product
            </button>
          </div>
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">
            {debouncedSearch
              ? `No decks match "${debouncedSearch}".`
              : 'No decks match the current filters.'}
          </p>
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
                  {view === 'grid' && !art && (
                    /* Fallback banner for non-commander decks (no art_crop
                       available). Same height as the commander art banner
                       so grid tiles stay uniform; mirrors binders grid
                       header treatment. */
                    <span className="decks-index-card-banner" aria-hidden>
                      {colorIdentity.length > 0 && (
                        <span className="decks-index-card-banner-pips">
                          {colorIdentity.map((c) => (
                            <ColorPip key={c} color={c} pip="lg" />
                          ))}
                        </span>
                      )}
                    </span>
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
                            <ColorPip key={c} color={c} />
                          ))}
                        </span>
                      )}
                      <span className="deck-format-badge">
                        {DECK_FORMAT_CONFIGS[deck.format]?.label ?? 'Commander'}
                      </span>
                      <span>
                        {deck.commander
                          ? `${deck.commander.name}${
                              deck.partnerCommander ? ` + ${deck.partnerCommander.name}` : ''
                            } · `
                          : ''}
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
                  onShare={() => setShareDeck(deck)}
                  onCompare={
                    decks.length >= 2 ? () => navigate(`/decks/compare?a=${deck.id}`) : undefined
                  }
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

      {shareDeck && (
        <ShareDialog
          kind="deck"
          resourceId={shareDeck.id}
          resourceLabel={shareDeck.name}
          onClose={() => setShareDeck(null)}
        />
      )}
    </div>
  );
}

function DeckCardMenu({
  canRegenerate,
  onRegenerate,
  onShare,
  onCompare,
  onDelete,
}: {
  canRegenerate: boolean;
  onRegenerate: () => void;
  onShare?: () => void;
  onCompare?: () => void;
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
          {onShare && (
            <button
              type="button"
              role="menuitem"
              className="decks-index-card-menu-item"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onShare();
              }}
            >
              Share
            </button>
          )}
          {onCompare && (
            <button
              type="button"
              role="menuitem"
              className="decks-index-card-menu-item"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onCompare();
              }}
            >
              Compare
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
