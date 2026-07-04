import { Check, ChevronDown, ChevronRight, Layers, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchCards } from '../lib/use-search-cards';
import { availableFinishes } from '../lib/scanner-feedback';
import { ManaCost } from './ManaCost';
import { CardPreview } from './CardPreview';
import { PrintingPicker, type AddExtras } from './PrintingPicker';
import { useCollectionStore } from '../store/collection';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';

interface Props {
  /** The shared collection search term — this panel never owns an input. */
  query: string;
  /** When provided, a Hide control is shown that calls this. */
  onClose?: () => void;
  /**
   * Add action. Defaults to adding the card to the collection
   * (`store.addCard`). Pass to retarget the same results UI elsewhere — e.g.
   * the list view adds a list entry instead. Receives the chosen printing and
   * finish (finish omitted on a plain quick-add → the result's default).
   * Retargeted adds hide the collection-only extras (quantity/condition/
   * language pickers and the remove-last-added undo).
   */
  onAdd?: (card: ScryfallCard, finish?: Finish) => Promise<void> | void;
}

const RESULT_LIMIT = 60;
const PAGE_SIZE = 10;

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
 * finish (plus quantity/condition/language) can be chosen inline. A "−"
 * next to the added count removes the last copy added this session, so a
 * mis-tap never needs a trip back to the collection table. All network
 * goes through the shared rate-limited, cached client.
 */
export function InlineCardSearch({ query, onClose, onAdd }: Props) {
  const addCard = useCollectionStore((s) => s.addCard);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const collection = useCollectionStore((s) => s.cards);

  const [openPrintingsId, setOpenPrintingsId] = useState<string | null>(null);
  // How many copies the user added this session, keyed by scryfall id, so
  // the row can confirm the action without re-deriving from the collection.
  const [addedCounts, setAddedCounts] = useState<Record<string, number>>({});
  // The collection copyIds behind those counts (collection mode only) —
  // what makes the "−" undo possible. Empty in retargeted (onAdd) mode.
  const [addedCopyIds, setAddedCopyIds] = useState<Record<string, string[]>>({});
  // Progressive reveal instead of an inner scrollbar — the page scrolls.
  const [visible, setVisible] = useState(PAGE_SIZE);
  // Index into `results` of the card whose full-size preview is open (null =
  // closed). The preview is a carousel over the entire result set, so swiping
  // can move past the progressively-revealed window.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Within the preview, which result has its printing/finish picker expanded
  // (keyed by scryfall id). Independent of the row-level disclosure above.
  const [previewPrintingsId, setPreviewPrintingsId] = useState<string | null>(null);

  const q = query.trim();
  const { results, loading, error } = useSearchCards(query, RESULT_LIMIT);

  // Reset per-result UI state when new results arrive. Defer to a microtask
  // to avoid synchronous setState inside an effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(() => {
      setVisible(PAGE_SIZE);
      setOpenPrintingsId(null);
      setPreviewIndex(null);
      setPreviewPrintingsId(null);
    });
  }, [results]);

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

  const confirm = (id: string, copyIds: string[] = [], count = Math.max(1, copyIds.length)) => {
    setAddedCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + count }));
    if (copyIds.length > 0) {
      setAddedCopyIds((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), ...copyIds] }));
    }
  };

  const quickAdd = async (card: ScryfallCard) => {
    if (onAdd) {
      await onAdd(card);
      confirm(card.id);
    } else {
      confirm(card.id, await addCard(card));
    }
  };

  const addPrinting = async (
    card: ScryfallCard,
    printing: ScryfallCard,
    finish: Finish,
    extras: AddExtras
  ) => {
    if (onAdd) {
      await onAdd(printing, finish);
      confirm(card.id);
    } else {
      confirm(card.id, await addCard(printing, finish, extras));
    }
  };

  // Remove the most recently added copy of this result (collection mode).
  // replaceAllCards re-runs allocation/binder remapping, same as the edit flow.
  const undoAdd = async (id: string) => {
    const ids = addedCopyIds[id];
    const last = ids?.[ids.length - 1];
    if (!last) return;
    setAddedCopyIds((prev) => ({ ...prev, [id]: ids.slice(0, -1) }));
    setAddedCounts((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 1) - 1) }));
    await replaceAllCards(useCollectionStore.getState().cards.filter((c) => c.copyId !== last));
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
            const canUndo = (addedCopyIds[c.id]?.length ?? 0) > 0;
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
                    {canUndo && (
                      <button
                        type="button"
                        className="inline-card-search-undo"
                        aria-label={`Remove last added copy of ${c.name}`}
                        onClick={() => void undoAdd(c.id)}
                      >
                        <Minus width={12} height={12} strokeWidth={2.5} aria-hidden />
                      </button>
                    )}
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
                    showExtras={!onAdd}
                    onAdd={(printing, finish, extras) =>
                      void addPrinting(c, printing, finish, extras)
                    }
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
                  showExtras={!onAdd}
                  onAdd={(printing, finish, extras) =>
                    void addPrinting(card, printing, finish, extras)
                  }
                />
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
