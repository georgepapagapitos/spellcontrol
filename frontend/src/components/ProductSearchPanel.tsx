import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlignJustify, ChevronLeft, Layers, LayoutGrid, Package, Rows3 } from 'lucide-react';
import { ViewModeToggle, type ViewModeOption } from './ViewModeToggle';
import { CardThumb } from './CardThumb';
import { searchProducts, fetchProduct, fetchProductCommanderSummary, useSetMap } from '../lib/api';
import { useBuildDeckFromImport } from '../lib/build-deck-from-import';
import { useCollectionStore } from '../store/collection';
import {
  PRODUCT_IMPORT_LABEL,
  groupPhysicalByZone,
  physicalCardsToUploadResponse,
} from '../lib/product-import';
import { createLimiter } from '../lib/concurrency-limit';
import { useCardCarousel, type CarouselEntry } from './deck/useCardCarousel';
import { ManaCost } from './ManaCost';
import { SearchPill } from './SearchPill';
import { getCardImageUrl } from '@/deck-builder/services/scryfall/client';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { DeckFormat } from '@/deck-builder/types';
import type {
  ProductCommanderSummary,
  ProductPhysicalCard,
  ProductResolveResponse,
  ProductSummary,
} from '../types';
import './ProductSearchPanel.css';

/** Carousel entries for a product's full physical contents (one swipeable card per copy-set). */
function physicalToEntries(physicalCards: ProductPhysicalCard[]): CarouselEntry[] {
  return physicalCards.map((pc) => ({
    name: pc.card.name,
    label: pc.quantity > 1 ? `${pc.quantity} copies` : '1 copy',
    card: pc.card,
  }));
}

/** Card-list layout for the precon detail — grid of art, roomy list, or dense list. */
type PreconLayout = 'grid' | 'list' | 'compact';
const LAYOUT_KEY = 'sc-precon-layout';

function readLayout(): PreconLayout {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return v === 'list' || v === 'compact' ? v : 'grid';
  } catch {
    return 'grid';
  }
}

const LAYOUT_OPTIONS: ViewModeOption<PreconLayout>[] = [
  { value: 'grid', label: 'Grid', icon: <LayoutGrid width={14} height={14} aria-hidden /> },
  { value: 'list', label: 'List', icon: <Rows3 width={14} height={14} aria-hidden /> },
  { value: 'compact', label: 'Compact', icon: <AlignJustify width={14} height={14} aria-hidden /> },
];

// Lazy per-row commander enrichment: cap concurrent /summary fetches so scrolling
// a long list doesn't fire dozens at once, and remember results across re-renders
// / scrolls (the backend caches too; this avoids even the round-trip).
const summaryLimiter = createLimiter(4);
const summaryCache = new Map<string, ProductCommanderSummary | null>();

/** Color-identity → mana-cost string for {@link ManaCost}; `{C}` for colorless. */
function colorIdentityCost(summary: ProductCommanderSummary | null | undefined): string {
  if (!summary) return '';
  return summary.colorIdentity.length > 0
    ? summary.colorIdentity.map((c) => `{${c}}`).join('')
    : '{C}';
}

const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

/** Screen-reader label for a commander's colors (the mana glyphs are decorative). */
function colorIdentityLabel(summary: ProductCommanderSummary): string {
  if (summary.colorIdentity.length === 0) return 'Colorless';
  return `Colors: ${summary.colorIdentity.map((c) => COLOR_NAMES[c] ?? c).join(', ')}`;
}

interface ResultRowProps {
  product: ProductSummary;
  set: { name: string; iconSvgUri: string } | undefined;
  disabled: boolean;
  onOpen: (p: ProductSummary) => void;
}

/**
 * One product search row. For Commander products it lazily fetches a compact
 * commander preview (art thumbnail + color pips) once the row scrolls into view,
 * throttled via the shared limiter. Falls back to the set symbol while loading
 * or for products without a commander.
 */
function ProductResultRow({ product, set, disabled, onOpen }: ResultRowProps) {
  // Commander + Brawl products have a commander whose colors/art we can preview.
  const wantSummary = /commander|brawl/i.test(product.type);
  const [summary, setSummary] = useState<ProductCommanderSummary | null | undefined>(() =>
    summaryCache.get(product.fileName)
  );
  const liRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!wantSummary || summary !== undefined) return;
    const el = liRef.current;
    if (!el) return;
    let done = false;
    const load = () => {
      if (done) return;
      done = true;
      void summaryLimiter(() => fetchProductCommanderSummary(product.fileName))
        .then((s) => {
          summaryCache.set(product.fileName, s);
          setSummary(s);
        })
        .catch(() => {
          // Treat a failed enrichment as "no commander" — the row still works.
          summaryCache.set(product.fileName, null);
          setSummary(null);
        });
    };
    // Fetch when the row nears the viewport; degrade to immediate fetch where
    // IntersectionObserver is unavailable.
    if (typeof IntersectionObserver === 'undefined') {
      load();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: '150px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [product.fileName, wantSummary, summary]);

  const art = summary?.image ?? null;
  const cost = colorIdentityCost(summary);

  return (
    <li ref={liRef}>
      <button
        type="button"
        className="product-result-row"
        onClick={() => onOpen(product)}
        disabled={disabled}
      >
        <span className="product-result-lead">
          {art ? (
            <img
              className="product-result-thumb"
              src={art}
              alt=""
              aria-hidden
              loading="lazy"
              draggable={false}
            />
          ) : set?.iconSvgUri ? (
            <img className="product-result-seticon" src={set.iconSvgUri} alt="" aria-hidden />
          ) : (
            <span className="product-result-seticon-empty" aria-hidden>
              {product.code}
            </span>
          )}
        </span>
        <span className="product-result-text">
          <span className="product-result-name">{product.name}</span>
          <span className="product-result-meta">
            {product.type}
            {set ? ` · ${set.name}` : ` · ${product.code}`}
            {product.releaseDate ? ` · ${product.releaseDate.slice(0, 4)}` : ''}
          </span>
        </span>
        {cost && summary && (
          <span
            className="product-result-colors"
            role="img"
            aria-label={colorIdentityLabel(summary)}
          >
            <ManaCost cost={cost} />
          </span>
        )}
      </button>
    </li>
  );
}

interface Props {
  /** Close the surrounding sheet (used after navigating to a created deck). */
  onClose: () => void;
}

/** Product types offered in the filter, most useful first. '' = all types. */
const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: 'Commander Deck', label: 'Commander' },
  { value: 'Planeswalker Deck', label: 'Planeswalker' },
  { value: 'Challenger Deck', label: 'Challenger' },
  { value: 'Duel Deck', label: 'Duel Deck' },
  { value: '', label: 'All types' },
];

const FORMAT_KEYS = Object.keys(DECK_FORMAT_CONFIGS);

/** Best deck format for a resolved product: its detected format, else commander. */
function deckFormatOf(resp: ProductResolveResponse): DeckFormat {
  const f = resp.deck.detectedFormat;
  if (FORMAT_KEYS.includes(f)) return f as DeckFormat;
  return resp.deck.commander ? 'commander' : 'standard';
}

/**
 * Search the MTGJSON product catalog and add a known product (Commander precons
 * first) as a deck and/or into the collection (T17). The Products tab of the
 * Add-cards sheet.
 */
export function ProductSearchPanel({ onClose }: Props) {
  const navigate = useNavigate();
  const buildDeckFromResult = useBuildDeckFromImport();
  const importCards = useCollectionStore((s) => s.importCards);
  const carousel = useCardCarousel('product');
  const setMap = useSetMap();

  const [query, setQuery] = useState('');
  const [type, setType] = useState(TYPE_FILTERS[0].value);
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ProductResolveResponse | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [layout, setLayout] = useState<PreconLayout>(readLayout);
  const debounceRef = useRef<number | null>(null);

  const chooseLayout = (next: PreconLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // non-fatal — preference just won't persist this session
    }
  };

  // Debounced product search. An empty query lists the newest products of the
  // chosen type so the tab is browsable, not just searchable.
  useEffect(() => {
    let cancelled = false;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setLoadingList(true);
      setListError(null);
      try {
        const products = await searchProducts(query.trim(), type || undefined);
        if (!cancelled) setResults(products);
      } catch (e) {
        if (!cancelled) {
          setListError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    }, 300);
    return () => {
      cancelled = true;
    };
  }, [query, type]);

  const openProduct = async (p: ProductSummary) => {
    setLoadingProduct(true);
    setProductError(null);
    setBanner(null);
    try {
      const resolved = await fetchProduct(p.fileName);
      setSelected(resolved);
    } catch (e) {
      setProductError(e instanceof Error ? e.message : 'Could not load this precon.');
    } finally {
      setLoadingProduct(false);
    }
  };

  const addAsDeck = (resp: ProductResolveResponse) => {
    const id = buildDeckFromResult(
      resp.deck,
      resp.deck.commander,
      resp.product.name,
      deckFormatOf(resp),
      {
        sourceProduct: {
          code: resp.product.code,
          fileName: resp.product.fileName,
          name: resp.product.name,
        },
      }
    );
    onClose();
    navigate(`/decks/${id}`);
  };

  const addToCollection = async (resp: ProductResolveResponse) => {
    const upload = physicalCardsToUploadResponse(resp.physicalCards);
    await importCards(upload, `${PRODUCT_IMPORT_LABEL}:${resp.product.name}`, 'merge');
    return upload.cards.length;
  };

  const handleAddToCollection = async (resp: ProductResolveResponse) => {
    setBusy(true);
    setProductError(null);
    try {
      const count = await addToCollection(resp);
      setBanner(`Added ${count.toLocaleString()} cards to your collection.`);
    } catch (e) {
      setProductError(e instanceof Error ? e.message : 'Could not add to collection.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddBoth = async (resp: ProductResolveResponse) => {
    setBusy(true);
    setProductError(null);
    try {
      await addToCollection(resp);
      addAsDeck(resp); // navigates + closes
    } catch (e) {
      setProductError(e instanceof Error ? e.message : 'Could not add this precon.');
      setBusy(false);
    }
  };

  // ---- Detail view ----------------------------------------------------------
  if (selected) {
    const groups = groupPhysicalByZone(selected.physicalCards);
    const entries = physicalToEntries(selected.physicalCards);
    const unresolved = selected.unresolvedNames.length;
    const renderZoneCards = (g: (typeof groups)[number]) => {
      if (layout === 'grid') {
        return (
          <ul className="product-card-grid" aria-label={g.label}>
            {g.cards.map((pc, i) => (
              <li key={`${pc.card.id}-${i}`} className="product-card-cell">
                <button
                  type="button"
                  className="product-card-btn"
                  aria-label={`Preview ${pc.card.name}`}
                  onClick={() => void carousel.open(entries, pc.card.name)}
                >
                  <CardThumb
                    className="product-card-img"
                    src={getCardImageUrl(pc.card, 'normal')}
                    alt={pc.card.name}
                  />
                  {pc.quantity > 1 && <span className="product-card-qty">{pc.quantity}</span>}
                </button>
              </li>
            ))}
          </ul>
        );
      }
      // list + compact share the row markup; compact just tightens via a modifier.
      return (
        <ul
          className={`product-card-list${layout === 'compact' ? ' is-compact' : ''}`}
          aria-label={g.label}
        >
          {g.cards.map((pc, i) => (
            <li key={`${pc.card.id}-${i}`}>
              <button
                type="button"
                className="product-card-row"
                aria-label={`Preview ${pc.card.name}`}
                onClick={() => void carousel.open(entries, pc.card.name)}
              >
                <CardThumb
                  className="product-card-rowthumb"
                  src={getCardImageUrl(pc.card, 'small')}
                  alt={pc.card.name}
                  decorative
                />
                <span className="product-card-rowname">{pc.card.name}</span>
                {pc.quantity > 1 && <span className="product-card-rowqty">×{pc.quantity}</span>}
              </button>
            </li>
          ))}
        </ul>
      );
    };

    return (
      <div className="add-card-search-panel">
        {/* Pinned head: back, identity, and the card-layout toggle. */}
        <div className="product-detail-head">
          <button type="button" className="product-back" onClick={() => setSelected(null)}>
            <ChevronLeft width={16} height={16} aria-hidden />
            <span>Back to search</span>
          </button>
          <h3 className="product-detail-name">{selected.product.name}</h3>
          <div className="product-detail-subhead">
            <p className="product-detail-meta">
              {selected.product.type}
              {selected.product.releaseDate
                ? ` · ${selected.product.releaseDate.slice(0, 4)}`
                : ''}{' '}
              · {selected.physicalCardCount.toLocaleString()} cards
            </p>
            <ViewModeToggle
              value={layout}
              onChange={chooseLayout}
              options={LAYOUT_OPTIONS}
              ariaLabel="Card layout"
            />
          </div>
        </div>

        {/* Scrollable cards — the single scroll region; head + actions stay pinned.
            Grouped by zone so the extras (display commanders, tokens) are visible
            at a glance; tap any card → shared preview carousel. */}
        <div className="add-card-sheet-body product-detail-cards">
          {groups.map((g) => (
            <section key={g.zone} className="product-zone">
              <h4 className="product-zone-title">
                {g.label} <span className="product-zone-count">({g.count})</span>
              </h4>
              {renderZoneCards(g)}
            </section>
          ))}

          {unresolved > 0 && (
            <p className="product-detail-warn">
              {unresolved} card{unresolved === 1 ? '' : 's'} couldn’t be matched to Scryfall and
              will be skipped. Check the contents against the physical box.
            </p>
          )}
        </div>

        {/* Pinned action footer. */}
        <div className="product-detail-foot">
          {banner && <div className="success-banner product-banner">{banner}</div>}
          {productError && <div className="error-banner product-banner">{productError}</div>}
          <div className="product-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => addAsDeck(selected)}
            >
              <Layers width={16} height={16} aria-hidden />
              <span>Add as deck</span>
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void handleAddToCollection(selected)}
            >
              <Package width={16} height={16} aria-hidden />
              <span>Add to collection</span>
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void handleAddBoth(selected)}
            >
              <span>Add both</span>
            </button>
          </div>
        </div>
        {carousel.preview}
      </div>
    );
  }

  // ---- Search / list view ---------------------------------------------------
  return (
    <div className="add-card-search-panel">
      <div className="add-card-search-input-wrap">
        <SearchPill
          placeholder="Search precons — e.g. “Fae Dominion”, “Goblin”"
          value={query}
          onChange={setQuery}
          ariaLabel="Search precons"
        />
        <div className="product-type-filters" role="group" aria-label="Product type">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.value || 'all'}
              type="button"
              className={`product-type-chip${type === t.value ? ' active' : ''}`}
              aria-pressed={type === t.value}
              onClick={() => setType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="add-card-sheet-body">
        {loadingProduct && <p className="card-picker-empty">Loading precon…</p>}
        {!loadingProduct && loadingList && <p className="card-picker-empty">Searching…</p>}
        {productError && !loadingProduct && (
          <p className="card-picker-empty add-card-sheet-error">{productError}</p>
        )}
        {listError && <p className="card-picker-empty add-card-sheet-error">{listError}</p>}
        {!loadingList && !listError && results.length === 0 && (
          <p className="card-picker-empty">
            No matching precons. Newly released precons may not be catalogued yet.
          </p>
        )}
        {!loadingList && results.length > 0 && (
          <ul className="product-result-list">
            {results.map((p) => (
              <ProductResultRow
                key={p.fileName}
                product={p}
                set={setMap?.[p.code.toUpperCase()]}
                disabled={loadingProduct}
                onOpen={(prod) => void openProduct(prod)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
