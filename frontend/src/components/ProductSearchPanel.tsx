import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Layers, Package } from 'lucide-react';
import { searchProducts, fetchProduct } from '../lib/api';
import { useBuildDeckFromImport } from '../lib/build-deck-from-import';
import { useCollectionStore } from '../store/collection';
import {
  PRODUCT_IMPORT_LABEL,
  physicalCardsToUploadResponse,
  zoneBreakdown,
} from '../lib/product-import';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { DeckFormat } from '@/deck-builder/types';
import type { ProductResolveResponse, ProductSummary } from '../types';
import './ProductSearchPanel.css';

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
  { value: '', label: 'All products' },
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
  const debounceRef = useRef<number | null>(null);

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
      setProductError(e instanceof Error ? e.message : 'Could not load this product.');
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
      setProductError(e instanceof Error ? e.message : 'Could not add this product.');
      setBusy(false);
    }
  };

  // ---- Detail view ----------------------------------------------------------
  if (selected) {
    const breakdown = zoneBreakdown(selected.physicalCards);
    const unresolved = selected.unresolvedNames.length;
    return (
      <div className="product-panel">
        <button type="button" className="product-back" onClick={() => setSelected(null)}>
          <ChevronLeft width={16} height={16} aria-hidden />
          <span>Back to search</span>
        </button>

        <div className="product-detail">
          <h3 className="product-detail-name">{selected.product.name}</h3>
          <p className="product-detail-meta">
            {selected.product.type}
            {selected.product.releaseDate
              ? ` · ${selected.product.releaseDate.slice(0, 4)}`
              : ''} · {selected.product.code}
          </p>

          <p className="product-detail-count">
            {selected.physicalCardCount.toLocaleString()} physical cards
          </p>
          <ul className="product-breakdown">
            {breakdown.map((b) => (
              <li key={b.zone}>
                <span className="product-breakdown-count">{b.count}</span> {b.label}
              </li>
            ))}
          </ul>

          {unresolved > 0 && (
            <p className="product-detail-warn">
              {unresolved} card{unresolved === 1 ? '' : 's'} couldn’t be matched to Scryfall and
              will be skipped. Check the contents against the physical box.
            </p>
          )}

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
          <p className="product-detail-hint">
            “Add as deck” builds the playable {selected.deck.cardCount}-card deck and pulls matching
            cards from your collection. “Add to collection” stamps every physical card (including
            display commanders &amp; tokens) as owned copies.
          </p>
        </div>
      </div>
    );
  }

  // ---- Search / list view ---------------------------------------------------
  return (
    <div className="product-panel">
      <div className="product-search-controls">
        <input
          type="search"
          className="card-picker-search"
          placeholder="Search products — e.g. “Fae Dominion”, “Goblin”"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search products"
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

      <div className="product-results">
        {loadingProduct && <p className="card-picker-empty">Loading product…</p>}
        {!loadingProduct && loadingList && <p className="card-picker-empty">Searching…</p>}
        {productError && !loadingProduct && (
          <p className="card-picker-empty add-card-sheet-error">{productError}</p>
        )}
        {listError && <p className="card-picker-empty add-card-sheet-error">{listError}</p>}
        {!loadingList && !listError && results.length === 0 && (
          <p className="card-picker-empty">
            No matching products. Newly released products may not be catalogued yet.
          </p>
        )}
        {!loadingList && results.length > 0 && (
          <ul className="product-result-list">
            {results.map((p) => (
              <li key={p.fileName}>
                <button
                  type="button"
                  className="product-result-row"
                  onClick={() => void openProduct(p)}
                  disabled={loadingProduct}
                >
                  <span className="product-result-name">{p.name}</span>
                  <span className="product-result-meta">
                    {p.type}
                    {p.releaseDate ? ` · ${p.releaseDate.slice(0, 4)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
