import { Check, ChevronDown, ChevronRight, Layers, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import { fetchPrintings } from '../lib/api';
import { formatMoney } from '../lib/format-money';
import { availableFinishes } from '../lib/scanner-feedback';
import { ManaCost } from './ManaCost';
import { CardPreview } from './CardPreview';
import { useCollectionStore } from '../store/collection';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';

interface Props {
  /** The shared collection search term — this panel never owns an input. */
  query: string;
  /** When provided, a Hide control is shown that calls this. */
  onClose?: () => void;
}

const RESULT_LIMIT = 60;
const PAGE_SIZE = 10;
const PRINTING_PAGE_SIZE = 8;
const FINISH_LABEL: Record<Finish, string> = {
  nonfoil: 'Non-foil',
  foil: 'Foil',
  etched: 'Etched',
};

function priceForFinish(card: ScryfallCard, finish: Finish): number {
  const p = card.prices;
  if (!p) return 0;
  const raw = finish === 'foil' ? p.usd_foil : finish === 'etched' ? p.usd_etched : p.usd;
  return raw ? Number(raw) || 0 : 0;
}

function cardThumb(card: ScryfallCard): string | undefined {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
}

/**
 * Live Scryfall search-and-add results panel, driven entirely by the
 * collection's own search bar (no second input — typing up top updates
 * these results). The trigger that opens it lives in the grid/list as
 * the trailing card/row. Quick-add uses the printing Scryfall returns
 * (nonfoil), same as the top-level Add card button; the per-row
 * "Printings" disclosure lazily loads every printing so a specific set +
 * finish can be chosen inline. All network goes through the shared
 * rate-limited, cached client.
 */
export function InlineCardSearch({ query, onClose }: Props) {
  const addCard = useCollectionStore((s) => s.addCard);
  const collection = useCollectionStore((s) => s.cards);

  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPrintingsId, setOpenPrintingsId] = useState<string | null>(null);
  // How many copies the user added this session, keyed by scryfall id, so
  // the row can confirm the action without re-deriving from the collection.
  const [addedCounts, setAddedCounts] = useState<Record<string, number>>({});
  // Progressive reveal instead of an inner scrollbar — the page scrolls.
  const [visible, setVisible] = useState(PAGE_SIZE);
  // Index into `results` of the card whose full-size preview is open (null =
  // closed). The preview is a carousel over the entire result set, so swiping
  // can move past the progressively-revealed window.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Within the preview, which result has its printing/finish picker expanded
  // (keyed by scryfall id). Independent of the row-level disclosure above.
  const [previewPrintingsId, setPreviewPrintingsId] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const q = query.trim();

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (q.length < 2) {
        if (!cancelled) {
          setResults([]);
          setError(null);
          setLoading(false);
        }
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, 300);
      });
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const resp = await searchCards(q, [], { skipFormatFilter: true });
        if (!cancelled) {
          setResults(resp.data.slice(0, RESULT_LIMIT));
          setVisible(PAGE_SIZE);
          setOpenPrintingsId(null);
          setPreviewIndex(null);
          setPreviewPrintingsId(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  const ownedCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of collection) {
      const k = c.name.toLowerCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [collection]);

  // Adapt the raw Scryfall results into the shape CardPreview consumes. The
  // carousel renders the full result set so a swipe can cross the visible
  // window; each card defaults to the nonfoil printing (same as quick-add).
  const previewCards = useMemo(() => results.map((c) => scryfallToEnrichedCard(c)), [results]);

  const confirm = (id: string) =>
    setAddedCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));

  const quickAdd = async (card: ScryfallCard) => {
    await addCard(card);
    confirm(card.id);
  };

  const addPrinting = async (card: ScryfallCard, finish: Finish) => {
    await addCard(card, finish);
    confirm(card.id);
  };

  return (
    <div className="inline-card-search">
      <div className="inline-card-search-head">
        <span className="inline-card-search-head-title">Scryfall results for “{q}”</span>
        {onClose && (
          <button type="button" className="inline-card-search-hide" onClick={onClose}>
            Hide
          </button>
        )}
      </div>
      {q.length < 2 && (
        <p className="inline-card-search-status">Type at least two characters above.</p>
      )}
      {q.length >= 2 && loading && <p className="inline-card-search-status">Searching Scryfall…</p>}
      {error && <p className="inline-card-search-status inline-card-search-error">{error}</p>}
      {q.length >= 2 && !loading && !error && results.length === 0 && (
        <p className="inline-card-search-status">No cards on Scryfall match “{q}”.</p>
      )}

      {results.length > 0 && (
        <ul className="inline-card-search-list" role="listbox" aria-label="Scryfall results">
          {results.slice(0, visible).map((c, idx) => {
            const owned = ownedCounts.get(c.name.toLowerCase()) ?? 0;
            const added = addedCounts[c.id] ?? 0;
            const printingsOpen = openPrintingsId === c.id;
            const finishes = availableFinishes(c.finishes);
            return (
              <li key={c.id} className="inline-card-search-item">
                <div className="inline-card-search-row">
                  <button
                    type="button"
                    className="inline-card-search-add"
                    aria-label={`Add ${c.name}`}
                    onClick={() => void quickAdd(c)}
                  >
                    {added > 0 ? (
                      <Check width={12} height={12} strokeWidth={2.5} aria-hidden />
                    ) : (
                      <Plus width={12} height={12} strokeWidth={2.5} aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    className="inline-card-search-preview-trigger"
                    aria-label={`Preview ${c.name}`}
                    onClick={() => setPreviewIndex(idx)}
                  >
                    {cardThumb(c) ? (
                      <img
                        src={cardThumb(c)}
                        alt=""
                        loading="lazy"
                        className="inline-card-search-thumb"
                      />
                    ) : (
                      <span
                        className="inline-card-search-thumb inline-card-search-thumb--ph"
                        aria-hidden
                      />
                    )}
                    <span className="inline-card-search-name">{c.name}</span>
                  </button>
                  {c.mana_cost && (
                    <ManaCost cost={c.mana_cost} className="inline-card-search-mana" />
                  )}
                  <span className="inline-card-search-meta">
                    {added > 0 && <span className="inline-card-search-added">added ×{added}</span>}
                    {owned > 0 && (
                      <span className="inline-card-search-owned">in collection ×{owned}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className={`inline-card-search-printings-toggle${
                      printingsOpen ? ' is-open' : ''
                    }`}
                    aria-expanded={printingsOpen}
                    onClick={() => setOpenPrintingsId(printingsOpen ? null : c.id)}
                  >
                    {printingsOpen ? (
                      <ChevronDown width={12} height={12} strokeWidth={2} aria-hidden />
                    ) : (
                      <ChevronRight width={12} height={12} strokeWidth={2} aria-hidden />
                    )}
                    {finishes.length > 1 ? 'Printing & finish' : 'Printing'}
                  </button>
                </div>
                {printingsOpen && (
                  <PrintingPicker
                    cardName={c.name}
                    fallback={c}
                    onAdd={(printing, finish) => void addPrinting(printing, finish)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {results.length > visible && (
        <button
          type="button"
          className="inline-card-search-more"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
        >
          Show {Math.min(PAGE_SIZE, results.length - visible)} more · {results.length - visible} not
          shown
        </button>
      )}

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="search"
          cards={previewCards}
          index={previewIndex}
          binderName=""
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={setPreviewIndex}
          onClose={() => {
            setPreviewIndex(null);
            setPreviewPrintingsId(null);
          }}
          getActions={(i) => {
            const card = results[i];
            if (!card) return [];
            const added = addedCounts[card.id] ?? 0;
            return [
              {
                key: 'add',
                icon:
                  added > 0 ? (
                    <Check width={18} height={18} strokeWidth={2.4} aria-hidden />
                  ) : (
                    <Plus width={18} height={18} strokeWidth={2.4} aria-hidden />
                  ),
                label: added > 0 ? `Added ×${added}` : 'Add',
                onClick: () => void quickAdd(card),
              },
              {
                key: 'printings',
                icon: <Layers width={18} height={18} strokeWidth={2} aria-hidden />,
                label: 'Printings',
                onClick: () => setPreviewPrintingsId((cur) => (cur === card.id ? null : card.id)),
              },
            ];
          }}
          renderPanelExtra={(i) => {
            const card = results[i];
            if (!card || previewPrintingsId !== card.id) return null;
            return (
              <div className="card-preview-printings">
                <PrintingPicker
                  cardName={card.name}
                  fallback={card}
                  onAdd={(printing, finish) => void addPrinting(printing, finish)}
                />
              </div>
            );
          }}
        />
      )}
    </div>
  );
}

function PrintingPicker({
  cardName,
  fallback,
  onAdd,
}: {
  cardName: string;
  fallback: ScryfallCard;
  onAdd: (printing: ScryfallCard, finish: Finish) => void;
}) {
  const [printings, setPrintings] = useState<ScryfallCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(fallback.id);
  const [finish, setFinish] = useState<Finish>('nonfoil');
  const [pVisible, setPVisible] = useState(PRINTING_PAGE_SIZE);

  // cardName is fixed for this picker's lifetime (a different row mounts a
  // fresh picker), so the initial loading/error state is correct and we
  // never need to reset synchronously inside the effect.
  useEffect(() => {
    let cancelled = false;
    fetchPrintings(cardName)
      .then((ps) => {
        if (cancelled) return;
        const list = ps.length > 0 ? ps : [fallback];
        setPrintings(list);
        setSelectedId(list.some((p) => p.id === fallback.id) ? fallback.id : list[0].id);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load printings');
        setPrintings([fallback]);
        setSelectedId(fallback.id);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardName, fallback]);

  const selected = printings?.find((p) => p.id === selectedId) ?? null;
  const finishes = useMemo<Finish[]>(
    () => (selected ? availableFinishes(selected.finishes) : ['nonfoil']),
    [selected]
  );
  // The user's explicit pick may not exist on a newly selected printing —
  // fall back to its first finish without an effect (no flicker, no
  // set-state-in-effect).
  const effectiveFinish: Finish = finishes.includes(finish) ? finish : finishes[0];

  return (
    <div className="inline-card-search-printings">
      {loading && <p className="inline-card-search-status">Loading printings…</p>}
      {error && <p className="inline-card-search-status inline-card-search-error">{error}</p>}
      {printings && (
        <>
          <ul className="inline-card-search-printing-list" role="listbox" aria-label="Printings">
            {printings.slice(0, pVisible).map((p) => {
              const isSel = p.id === selectedId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    className={`inline-card-search-printing${isSel ? ' is-selected' : ''}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className="inline-card-search-printing-set">
                      {p.set.toUpperCase()} #{p.collector_number}
                    </span>
                    <span className="inline-card-search-printing-set-name">{p.set_name}</span>
                    <span className="inline-card-search-printing-price">
                      {formatMoney(priceForFinish(p, 'nonfoil') || priceForFinish(p, 'foil'), {
                        zeroAsDash: true,
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {printings.length > pVisible && (
            <button
              type="button"
              className="inline-card-search-more inline-card-search-more--printings"
              onClick={() => setPVisible((v) => v + PRINTING_PAGE_SIZE)}
            >
              Show {Math.min(PRINTING_PAGE_SIZE, printings.length - pVisible)} more printings
            </button>
          )}
          {selected && (
            <div className="inline-card-search-finish-bar">
              <div className="inline-card-search-finishes" role="group" aria-label="Finish">
                {finishes.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`inline-card-search-finish${
                      effectiveFinish === f ? ' is-active' : ''
                    }`}
                    aria-pressed={effectiveFinish === f}
                    onClick={() => setFinish(f)}
                  >
                    {FINISH_LABEL[f]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="inline-card-search-add-printing"
                onClick={() => onAdd(selected, effectiveFinish)}
              >
                Add {selected.set.toUpperCase()} #{selected.collector_number} ·{' '}
                {FINISH_LABEL[effectiveFinish]} ·{' '}
                {formatMoney(priceForFinish(selected, effectiveFinish), { zeroAsDash: true })}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
