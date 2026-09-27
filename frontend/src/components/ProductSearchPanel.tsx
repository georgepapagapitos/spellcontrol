import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlignJustify, ChevronLeft, Layers, LayoutGrid, Package, Rows3 } from 'lucide-react';
import { ViewModeToggle, type ViewModeOption } from './ViewModeToggle';
import { CardThumb } from './CardThumb';
import { searchProducts, fetchProduct } from '../lib/api';
import {
  colorIdentityCost,
  colorIdentityLabel,
  useProductCommander,
} from '../lib/use-product-commander';
import { useBuildDeckFromImport } from '../lib/build-deck-from-import';
import { useCollectionStore } from '../store/collection';
import { useBinderLayoutInputs } from '../lib/use-binder-layout-inputs';
import {
  PRODUCT_IMPORT_LABEL,
  groupPhysicalByZone,
  physicalCardsToUploadResponse,
} from '../lib/product-import';
import { fetchErrorMessage } from '../lib/import-review';
import { summarizeImportRouting } from '../lib/import-routing';
import { useCardCarousel, type CarouselEntry } from './deck/useCardCarousel';
import { ManaCost } from './ManaCost';
import { SearchPill } from './SearchPill';
import { ImportRoutingSummary } from './ImportRoutingSummary';
import { getCardImageUrl } from '@/deck-builder/services/scryfall/client';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { namedPartner } from '@/deck-builder/lib/partnerUtils';
import type { DeckFormat } from '@/deck-builder/types';
import type {
  ProductPhysicalCard,
  ProductResolveResponse,
  ProductSummary,
  UploadResponse,
} from '../types';
import './ProductSearchPanel.css';

import { userMessage } from '@/lib/user-error';
import { Button } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { Field, SwitchRow } from '@/components/shared/form';
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
  const { summary, ref: liRef } = useProductCommander<HTMLLIElement>(product.fileName, wantSummary);

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
  /**
   * Which action this host wants first. The Add-cards sheet (Collection) adds
   * to the collection first, with building the deck as an optional switch; the
   * Decks page's "Add a product" stays deck-first, with adding to the
   * collection as the optional switch. Secret Lair drops ignore this — they
   * have no deck, so they are always collection-only.
   */
  context?: 'collection' | 'deck';
}

const MAX_PRODUCT_QUANTITY = 10;

/**
 * "I bought two of this box" — a 1-10 stepper reused from the collection's
 * existing copy-count control (`.card-edit-qty`, see RemoveCopiesDialog /
 * CardEditDialog) so a transactional quantity looks the same everywhere it
 * appears instead of inventing a new control.
 */
function ProductQuantityField({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.max(1, Math.min(MAX_PRODUCT_QUANTITY, n));
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setText(String(value));
  }
  const inputId = useId();
  // A kit Field: a sentence-case label bound to the input (§ Config surfaces),
  // and a stepper sized to its content rather than stretched across the sheet.
  return (
    <Field label="Copies" htmlFor={inputId}>
      <div className="card-edit-qty-controls product-qty-controls">
        <button
          type="button"
          className="card-edit-qty-btn"
          onClick={() => onChange(clamp(value - 1))}
          disabled={disabled || value <= 1}
          aria-label="One fewer copy"
        >
          −
        </button>
        <input
          id={inputId}
          type="number"
          className="card-edit-qty-input product-qty-input"
          min={1}
          max={MAX_PRODUCT_QUANTITY}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = Math.floor(Number(text));
            const next = Number.isFinite(n) ? clamp(n) : 1;
            onChange(next);
            setText(String(next));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <button
          type="button"
          className="card-edit-qty-btn"
          onClick={() => onChange(clamp(value + 1))}
          disabled={disabled || value >= MAX_PRODUCT_QUANTITY}
          aria-label="One more copy"
        >
          +
        </button>
      </div>
    </Field>
  );
}

/** Repeats a product's physical contents `times` over, one fresh copy set per
 *  repeat (so every card gets its own copyId) — "I bought N of this box". */
function uploadForQuantity(physicalCards: ProductPhysicalCard[], times: number): UploadResponse {
  const runs = Array.from({ length: Math.max(1, times) }, () =>
    physicalCardsToUploadResponse(physicalCards)
  );
  return {
    cards: runs.flatMap((r) => r.cards),
    totalRows: runs.reduce((sum, r) => sum + r.totalRows, 0),
    scryfallHits: runs.reduce((sum, r) => sum + r.scryfallHits, 0),
    scryfallMisses: 0,
    unresolvedNames: [],
    fetchErrors: [],
    malformedRows: [],
    skippedUnownedRows: 0,
    clampedRows: 0,
    detectedFormat: 'mtgjson',
  };
}

/** What landed after "add to collection": the count, the import(s) to route,
 *  and the deck id when the deck switch was also on (so the footer can offer
 *  "Open deck" instead of navigating away mid-summary). */
interface AddResult {
  productName: string;
  count: number;
  importIds: Set<string>;
  deckId: string | null;
}

/** Product types offered in the filter, most useful first. '' = all types. */
const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: 'Commander Deck', label: 'Commander' },
  { value: 'Planeswalker Deck', label: 'Planeswalker' },
  { value: 'Challenger Deck', label: 'Challenger' },
  { value: 'Duel Deck', label: 'Duel Deck' },
  { value: 'Secret Lair Drop', label: 'Secret Lair' },
  { value: '', label: 'All types' },
];

/**
 * Secret Lair drops are a curated card list, not a playable deck — they have no
 * commander/main 100, so only "Add to collection" makes sense. (Secret Lair
 * *Commander Decks* carry MTGJSON type "Commander Deck", so they're unaffected.)
 */
function isCardListProduct(type: string): boolean {
  return type === 'Secret Lair Drop';
}

const FORMAT_KEYS = Object.keys(DECK_FORMAT_CONFIGS);

/** Best deck format for a resolved product: its detected format, else commander. */
function deckFormatOf(resp: ProductResolveResponse): DeckFormat {
  const f = resp.deck.detectedFormat;
  if (FORMAT_KEYS.includes(f)) return f as DeckFormat;
  return resp.deck.commander ? 'commander' : 'standard';
}

/**
 * Search the MTGJSON product catalog and add a known product (Commander precons
 * first, Secret Lair drops, etc.) to the collection and/or as a deck (T17/E31,
 * T153). `context` picks which action is primary: the Add-cards sheet
 * (`context="collection"`, the default) adds to the collection first with
 * building the deck as a "Also build it as a deck" switch; the Decks page's
 * "Add a product" (`context="deck"`) stays deck-first with an "Also add the
 * cards to my collection" switch. Card-list products (Secret Lair drops) have
 * no deck, so they are always collection-only regardless of context. A
 * quantity stepper covers "I bought N of this box"; adding to the collection
 * shows the same routing summary the list-import review surface uses.
 */
export function ProductSearchPanel({ onClose, context = 'collection' }: Props) {
  const navigate = useNavigate();
  const buildDeckFromResult = useBuildDeckFromImport();
  const importCards = useCollectionStore((s) => s.importCards);
  // Same inputs BinderPage materializes from — shared so "where did my
  // cards go?" can't drift from what a binder actually shows (E457). Named
  // `binderLayout` (not `layout`) since this file's own `layout` state below
  // is the unrelated product-grid/list view preference.
  const binderLayout = useBinderLayoutInputs();
  const { setMap } = binderLayout;
  const carousel = useCardCarousel('product');

  const [query, setQuery] = useState('');
  const [type, setType] = useState(TYPE_FILTERS[0].value);
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ProductResolveResponse | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [quantity, setQuantity] = useState(1);
  // Collection context: "also build it as a deck". Deck context: "also add
  // to my collection". Only one applies per context, but keeping them as two
  // booleans (rather than one shared flag) keeps each default independent —
  // deck-first hosts default the collection add OFF, same as before T153.
  const [alsoBuildDeck, setAlsoBuildDeck] = useState(false);
  const [alsoAddToCollection, setAlsoAddToCollection] = useState(false);
  const [result, setResult] = useState<AddResult | null>(null);
  const [layout, setLayout] = useState<PreconLayout>(readLayout);
  const debounceRef = useRef<number | null>(null);

  const routingSummary = result ? summarizeImportRouting(result.importIds, binderLayout) : null;

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
          setListError(
            userMessage(e, "Couldn't run that search. Check your connection and try again.")
          );
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
    setResult(null);
    setQuantity(1);
    setAlsoBuildDeck(false);
    setAlsoAddToCollection(false);
    try {
      const resolved = await fetchProduct(p.fileName);
      setSelected(resolved);
    } catch (e) {
      setProductError(userMessage(e, "Couldn't load this product."));
    } finally {
      setLoadingProduct(false);
    }
  };

  /** Builds the deck from the resolved product's playable 100. Read fresh
   *  collection state at call time (inside buildDeckFromResult), so calling
   *  this AFTER a collection add allocates against the copies just added
   *  rather than marking them all unowned. */
  const buildDeck = (resp: ProductResolveResponse): string =>
    buildDeckFromResult(resp.deck, resp.deck.commander, resp.product.name, deckFormatOf(resp), {
      // A precon with two commanders (a partner pair, a Background) keeps
      // both in the command zone.
      partner: namedPartner(resp.deck.commander, resp.deck.partner),
      sourceProduct: {
        code: resp.product.code,
        fileName: resp.product.fileName,
        name: resp.product.name,
      },
    });

  /** Pure "Add as deck", no collection touched: builds and navigates straight
   *  there, closing the sheet. Nothing to review, so no summary to show. */
  const addAsDeckOnly = (resp: ProductResolveResponse) => {
    const id = buildDeck(resp);
    onClose();
    navigate(`/decks/${id}`);
  };

  /** Imports N copies of the product into the collection, optionally also
   *  building the deck (always AFTER the import completes, per the ordering
   *  above). Stays on this screen and shows the routing summary instead of
   *  navigating away, so "where did my cards go?" is answered before the
   *  sheet closes. */
  const addToCollection = async (resp: ProductResolveResponse, alsoDeck: boolean) => {
    setBusy(true);
    setProductError(null);
    try {
      const upload = uploadForQuantity(resp.physicalCards, quantity);
      const importId = await importCards(
        upload,
        `${PRODUCT_IMPORT_LABEL}:${resp.product.name}`,
        'merge'
      );
      const deckId = alsoDeck ? buildDeck(resp) : null;
      setResult({
        productName: resp.product.name,
        count: upload.cards.length,
        importIds: new Set([importId]),
        deckId,
      });
    } catch (e) {
      setProductError(userMessage(e, "Couldn't add that to your collection. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const handlePrimaryAction = (resp: ProductResolveResponse) => {
    if (isCardListProduct(resp.product.type)) return void addToCollection(resp, false);
    if (context === 'collection') return void addToCollection(resp, alsoBuildDeck);
    if (alsoAddToCollection) return void addToCollection(resp, true);
    addAsDeckOnly(resp);
  };

  const openBuiltDeck = (deckId: string, plan = false) => {
    onClose();
    navigate(plan ? `/decks/${deckId}?view=tune&plan=1` : `/decks/${deckId}`);
  };

  // ---- Detail view ----------------------------------------------------------
  if (selected) {
    const groups = groupPhysicalByZone(selected.physicalCards);
    const entries = physicalToEntries(selected.physicalCards);
    const unresolved = selected.unresolvedNames.length;
    const cardListProduct = isCardListProduct(selected.product.type);
    // Deck context only skips the collection add (and its quantity) when the
    // "also add to my collection" switch is off; every other case adds to the
    // collection, so the quantity stepper and the total in the primary label
    // both apply.
    const addsToCollection = cardListProduct || context === 'collection' || alsoAddToCollection;
    const totalCount = selected.physicalCardCount * quantity;
    const primaryLabel = addsToCollection
      ? `Add ${totalCount.toLocaleString()} card${totalCount === 1 ? '' : 's'} to collection`
      : 'Add as deck';
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
              {unresolved} card{unresolved === 1 ? '' : 's'} couldn't be matched to Scryfall and
              will be skipped. Check the contents against the physical box.
            </p>
          )}

          {selected.fetchErrors.length > 0 && (
            <p className="product-detail-warn">
              {fetchErrorMessage(
                selected.fetchErrors.length,
                'The card service was unreachable, so this list is incomplete.'
              )}{' '}
              <Button
                variant="link"
                onClick={() => void openProduct(selected.product)}
                disabled={busy || loadingProduct}
              >
                Try again
              </Button>
            </p>
          )}
        </div>

        {/* Pinned action footer. */}
        <div className="product-detail-foot">
          {result && (
            <div className="import-review product-review" role="status" aria-live="polite">
              <div className="import-review-header">
                <span className="import-review-title">Import summary</span>
                <button
                  type="button"
                  className="banner-dismiss"
                  onClick={() => setResult(null)}
                  aria-label="Dismiss import summary"
                >
                  ×
                </button>
              </div>
              <p className="import-review-line">
                Added {result.count.toLocaleString()} card{result.count === 1 ? '' : 's'} from{' '}
                {result.productName} to your collection.
              </p>
              {routingSummary &&
                (routingSummary.entries.length > 0 || routingSummary.unroutedCount > 0) && (
                  <div className="import-review-section import-review-section--routing">
                    <ImportRoutingSummary summary={routingSummary} />
                  </div>
                )}
              {result.deckId && (
                <div className="product-review-actions">
                  <Button
                    variant="primary"
                    onClick={() => openBuiltDeck(result.deckId as string)}
                    icon={<Layers width={16} height={16} />}
                  >
                    Open deck
                  </Button>
                  {/* E458: straight into the deck's upgrade plan. */}
                  <Button
                    variant="secondary"
                    onClick={() => openBuiltDeck(result.deckId as string, true)}
                  >
                    Plan upgrades
                  </Button>
                </div>
              )}
            </div>
          )}
          {productError && <div className="error-banner product-banner">{productError}</div>}
          <div className="product-actions">
            {!cardListProduct && context === 'collection' && (
              <SwitchRow
                label="Also build it as a deck"
                hint="Creates the deck in Decks from these copies"
                checked={alsoBuildDeck}
                onChange={setAlsoBuildDeck}
                disabled={busy}
              />
            )}
            {!cardListProduct && context === 'deck' && (
              <SwitchRow
                label="Also add the cards to my collection"
                hint="Adds every copy in the box to your collection too"
                checked={alsoAddToCollection}
                onChange={setAlsoAddToCollection}
                disabled={busy}
              />
            )}
            {addsToCollection && (
              <ProductQuantityField value={quantity} onChange={setQuantity} disabled={busy} />
            )}
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => handlePrimaryAction(selected)}
              icon={
                addsToCollection ? (
                  <Package width={16} height={16} />
                ) : (
                  <Layers width={16} height={16} />
                )
              }
            >
              {primaryLabel}
            </Button>
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
          placeholder="Search products"
          value={query}
          onChange={setQuery}
          ariaLabel="Search products"
        />
        <div className="product-type-filters" role="group" aria-label="Product type">
          {TYPE_FILTERS.map((t) => (
            <Chip
              key={t.value || 'all'}
              className="filter-chip"
              pressed={type === t.value}
              onClick={() => setType(t.value)}
            >
              {t.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="add-card-sheet-body">
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
