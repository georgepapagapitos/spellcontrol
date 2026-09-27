import { Check, ChevronDown, ChevronRight, Layers, Minus, Plus } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { ManaCost } from './ManaCost';
import { CardPreview } from './CardPreview';
import { PrintingPicker, type AddExtras } from './PrintingPicker';
import { addedCardMessage, landedFinish } from '../lib/add-card-message';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';
import { entryKey, useScanQueue } from '../lib/use-scan-queue';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import { imageFromCard } from '../lib/card-thumbs';
import { availableFinishes } from '../lib/scanner-feedback';
import { haptics } from '../lib/haptics';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { IconButton } from '@/components/shared/Button';

/** Result layouts: `list` (thumbnail rows, the default), `grid` (card-image
 *  tiles, preview-first), `compact` (text-only rows). */
export type CardSearchResultsView = 'grid' | 'list' | 'compact';

/** Imperative keyboard-nav surface for a host that owns a search input
 *  elsewhere in the tree (this component renders no input of its own). */
export interface CardSearchResultsHandle {
  /** Move the active row by one row (list/compact views only). */
  moveActive: (delta: 1 | -1) => void;
  /** Add the active row's card, same as clicking its "+". */
  addActive: () => void;
}

interface Props {
  results: ScryfallCard[];
  view?: CardSearchResultsView;
  /** Reveal this many rows/tiles at a time behind a "Show N more" button.
   *  Omit to render every result at once (the Add-cards sheet's short list). */
  pageSize?: number;
  /** Scryfall's true match count, for a "Showing X of Y" note when the
   *  fetcher already capped `results` below what actually matched. */
  total?: number | null;
  /** Pin every add to this binder, and unpin its copies on undo. */
  binderId?: string;
  /**
   * Retarget the add away from the collection (e.g. a list entry). Retargeted
   * adds skip the collection toast and the row's "−" undo — the caller owns
   * that feedback — but still flip the row to its added state.
   */
  onAdd?: (card: ScryfallCard, finish?: Finish) => Promise<void> | void;
  /** Fires after any successful add, on top of whatever `onAdd` does. */
  onAdded?: (card: ScryfallCard, finish?: Finish) => void;
  /**
   * Retarget every add into the device-local Add list (T153) instead of the
   * collection — the unified Add-cards sheet's Search tab. Takes priority
   * over `onAdd`/`binderId` (they aren't both passed in practice). A row
   * already in the list shows a −/+ stepper instead of "+"; there's no
   * collection toast, only a polite live-region announcement.
   */
  addToList?: boolean;
}

const DEFAULT_PAGE = 10;

/** One wording for "this many copies are already in the collection",
 *  used in the row, the grid badge and the preview label alike. */
function ownedLabel(count: number): string {
  return count > 0 ? `You own ${count}` : '';
}

/**
 * The shared search-result engine: one row (list/compact) or tile (grid),
 * one add/undo/toast behavior, one preview carousel. {@link AddCardSearchPanel}
 * and {@link InlineCardSearch} both render this for their results — it is the
 * only place that owns the add pill, the printing disclosure and the
 * card-preview wiring, so the two surfaces can no longer drift apart.
 *
 * Doesn't own a search input; the host supplies `results` and, when it has
 * one on screen, can drive keyboard navigation through the ref handle.
 */
export const CardSearchResults = forwardRef<CardSearchResultsHandle, Props>(
  function CardSearchResults(
    { results, view = 'list', pageSize, total = null, binderId, onAdd, onAdded, addToList },
    ref
  ) {
    const addCard = useCollectionStore((s) => s.addCard);
    const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
    const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
    const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
    const collection = useCollectionStore((s) => s.cards);
    const pushToast = useToastsStore((s) => s.push);
    const {
      queue: addListQueue,
      addManual: addToAddList,
      changeQty: changeAddListQty,
    } = useScanQueue();

    const [activeIndex, setActiveIndex] = useState(0);
    // Row 0 is the logical active row from the start (Enter with no arrow
    // presses adds the top result), but the visual highlight ring only makes
    // sense once a host has actually driven it — most hosts render this list
    // with no keyboard wiring at all, and a permanent ring around row 1 there
    // reads as a stray focus state nobody asked for.
    const [navigated, setNavigated] = useState(false);
    const [openPrintingsId, setOpenPrintingsId] = useState<string | null>(null);
    const [visible, setVisible] = useState(pageSize ?? Infinity);
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const [previewPrintingsId, setPreviewPrintingsId] = useState<string | null>(null);
    // Copies added this session, keyed by result id — powers the ×N count and
    // the row's "−" undo. Retargeted (onAdd) adds carry no copyId, so they
    // bump `addedCounts` only.
    const [addedCounts, setAddedCounts] = useState<Record<string, number>>({});
    const [addedCopyIds, setAddedCopyIds] = useState<Record<string, string[]>>({});
    // addToList mode only: a polite live-region announcement in place of the
    // collection toast (there's no toast — the row's own stepper is the
    // confirmation, this is just the screen-reader equivalent of it).
    const [addListAnnouncement, setAddListAnnouncement] = useState('');

    // Reset per-result UI state whenever the result set changes. Deferred to a
    // microtask so a render immediately followed by a click (tests) doesn't
    // land the reset after the click and collapse whatever it just opened.
    useEffect(() => {
      void Promise.resolve().then(() => {
        setActiveIndex(0);
        setNavigated(false);
        setOpenPrintingsId(null);
        setVisible(pageSize ?? Infinity);
        setPreviewIndex(null);
        setPreviewPrintingsId(null);
      });
      // pageSize is a caller constant, not a dependency worth re-triggering on.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [results]);

    const ownedCounts = useMemo(() => {
      const m = new Map<string, number>();
      for (const c of collection) m.set(c.name, (m.get(c.name) ?? 0) + 1);
      return m;
    }, [collection]);

    const previewCards = useMemo(() => results.map((c) => scryfallToEnrichedCard(c)), [results]);

    // T153 Add-list target: qty already queued for the printing+finish a
    // quick add (no picker) or an explicit picker pick would land in.
    const listQtyFor = (card: ScryfallCard, finish?: Finish): number => {
      const f = finish ?? landedFinish(card, undefined, true);
      return addListQueue.find((e) => e.id === entryKey(card.id, f))?.qty ?? 0;
    };

    // Context line under the art: what this session added, else what the
    // collection already holds — the same wording as the row and the grid
    // badge, so the preview never contradicts what the list just said.
    const previewLabels = results.map((c) => {
      const added = addToList ? listQtyFor(c) : (addedCounts[c.id] ?? 0);
      if (added > 0) return `Added ×${added}`;
      return ownedLabel(ownedCounts.get(c.name) ?? 0);
    });

    const confirm = (id: string, copyIds: string[] = [], count = Math.max(1, copyIds.length)) => {
      setAddedCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + count }));
      if (copyIds.length > 0) {
        setAddedCopyIds((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), ...copyIds] }));
      }
    };

    // Drop specific copies added this session. replaceAllCards re-runs
    // allocation/binder remapping, same as the edit flow. One path for both
    // undo affordances — the row's "−" (last copy) and the toast's Undo (that
    // add's whole batch, so undoing a 4× add doesn't silently leave 3 behind).
    const removeCopies = async (id: string, ids: string[]) => {
      if (ids.length === 0) return;
      const dropping = new Set(ids);
      setAddedCopyIds((prev) => ({
        ...prev,
        [id]: (prev[id] ?? []).filter((c) => !dropping.has(c)),
      }));
      setAddedCounts((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) - ids.length) }));
      if (binderId) for (const copyId of ids) removeCardFromBinder(binderId, copyId, false);
      await replaceAllCards(
        useCollectionStore.getState().cards.filter((c) => !dropping.has(c.copyId))
      );
      haptics.tap();
    };

    // A real collection add confirms itself with a toast naming the printing
    // and finish that landed (plus "pinned to this binder"), with Undo.
    const addToCollection = async (
      id: string,
      printing: ScryfallCard,
      finish?: Finish,
      extras?: AddExtras
    ) => {
      const copyIds = await addCard(printing, finish, extras);
      if (binderId) for (const copyId of copyIds) pinCardToBinder(binderId, copyId);
      confirm(id, copyIds);
      haptics.tap();
      pushToast({
        message: addedCardMessage(
          printing,
          copyIds.length,
          finish,
          Boolean(binderId),
          extras === undefined
        ),
        tone: 'success',
        durationMs: 4000,
        actionLabel: 'Undo',
        onAction: () => void removeCopies(id, copyIds),
      });
    };

    const announceListAdd = (name: string, newQty: number) => {
      setAddListAnnouncement(
        `Added ${name} to the add list, ${newQty} card${newQty === 1 ? '' : 's'}`
      );
    };

    const quickAdd = async (card: ScryfallCard) => {
      if (addToList) {
        const newQty = listQtyFor(card) + 1;
        addToAddList(card, { source: 'searched' });
        announceListAdd(card.name, newQty);
      } else if (onAdd) {
        await onAdd(card);
        confirm(card.id);
      } else {
        await addToCollection(card.id, card);
      }
      onAdded?.(card);
    };

    // Stepper "−": drop one copy from an already-queued row.
    const decrementListEntry = (card: ScryfallCard, finish?: Finish) => {
      const f = finish ?? landedFinish(card, undefined, true);
      changeAddListQty(entryKey(card.id, f), -1);
    };

    const addPrinting = async (
      card: ScryfallCard,
      printing: ScryfallCard,
      finish: Finish,
      extras: AddExtras
    ) => {
      if (addToList) {
        const newQty = listQtyFor(printing, finish) + (extras.quantity ?? 1);
        addToAddList(printing, {
          finish,
          condition: extras.condition,
          language: extras.language,
          qty: extras.quantity,
          source: 'searched',
        });
        announceListAdd(printing.name, newQty);
      } else if (onAdd) {
        await onAdd(printing, finish);
        confirm(card.id);
      } else {
        await addToCollection(card.id, printing, finish, extras);
      }
      onAdded?.(printing, finish);
    };

    const undoAdd = (id: string) => {
      const last = addedCopyIds[id]?.at(-1);
      if (last) void removeCopies(id, [last]);
    };

    useImperativeHandle(
      ref,
      () => ({
        moveActive: (delta) => {
          setNavigated(true);
          setActiveIndex((i) => Math.min(results.length - 1, Math.max(0, i + delta)));
        },
        addActive: () => {
          const card = results[Math.min(activeIndex, results.length - 1)];
          if (card) void quickAdd(card);
        },
      }),
      // quickAdd closes over onAdd/onAdded/binderId, all stable-ish props;
      // re-created per render is cheap and keeps the handle always current.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [results, activeIndex]
    );

    if (results.length === 0) return null;

    const shown = results.slice(0, visible);

    return (
      <>
        {view === 'grid' ? (
          <ul className="inline-card-search-grid" aria-label="Search results">
            {shown.map((c, idx) => {
              const owned = ownedCounts.get(c.name) ?? 0;
              const added = addedCounts[c.id] ?? 0;
              const img = imageFromCard(c, 'normal');
              const badge = added > 0 ? `Added ×${added}` : ownedLabel(owned);
              return (
                <li key={c.id} className="inline-card-search-tile">
                  <button
                    type="button"
                    className="collection-grid-item inline-card-search-tile-btn"
                    aria-label={`Preview ${c.name}`}
                    onClick={() => setPreviewIndex(idx)}
                  >
                    {img ? (
                      <img src={img} alt="" loading="lazy" className="collection-grid-img" />
                    ) : (
                      <span className="collection-grid-placeholder">{c.name}</span>
                    )}
                  </button>
                  {/* The caption carries the printing, the owned/added count and the
                      "+" under the art, never over it: on a touch screen a 44px "+"
                      on the art covered the mana cost (E453). */}
                  <div className="inline-card-search-tile-caption">
                    <span className="inline-card-search-tile-meta">
                      <span className="inline-card-search-tile-printing">
                        {c.set.toUpperCase()} #{c.collector_number}
                      </span>
                      {badge && <span className="inline-card-search-tile-owned">{badge}</span>}
                    </span>
                    <IconButton
                      variant="secondary"
                      className="inline-card-search-tile-add"
                      onClick={() => void quickAdd(c)}
                      label={added > 0 ? `Add another ${c.name}` : `Add ${c.name}`}
                      icon={
                        added > 0 ? (
                          <Check width={14} height={14} strokeWidth={2.5} />
                        ) : (
                          <Plus width={14} height={14} strokeWidth={2.5} />
                        )
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="inline-card-search-list" role="listbox" aria-label="Search results">
            {shown.map((c, idx) => {
              const owned = ownedCounts.get(c.name) ?? 0;
              const added = addedCounts[c.id] ?? 0;
              const canUndo = (addedCopyIds[c.id]?.length ?? 0) > 0;
              const listQty = addToList ? listQtyFor(c) : 0;
              const printingsOpen = openPrintingsId === c.id;
              const finishes = availableFinishes(c.finishes);
              const active = idx === activeIndex;
              const thumb = view === 'compact' ? undefined : imageFromCard(c, 'normal');
              return (
                <li
                  key={c.id}
                  className="inline-card-search-item"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => {
                    setNavigated(true);
                    setActiveIndex(idx);
                  }}
                >
                  <div className={`inline-card-search-row${active && navigated ? ' active' : ''}`}>
                    {listQty > 0 ? (
                      <span
                        className="inline-card-search-stepper"
                        role="group"
                        aria-label={`${c.name} in the add list`}
                      >
                        <IconButton
                          className="inline-card-search-stepper-btn"
                          onClick={() => decrementListEntry(c)}
                          label={`One fewer ${c.name}`}
                          icon={<Minus width={12} height={12} strokeWidth={2.5} />}
                        />
                        <output aria-hidden>{listQty}</output>
                        <IconButton
                          className="inline-card-search-stepper-btn"
                          onClick={() => void quickAdd(c)}
                          label={`One more ${c.name}`}
                          icon={<Plus width={12} height={12} strokeWidth={2.5} />}
                        />
                      </span>
                    ) : (
                      <IconButton
                        className="inline-card-search-add"
                        onClick={() => void quickAdd(c)}
                        label={added > 0 ? `Add another ${c.name}` : `Add ${c.name}`}
                        icon={
                          added > 0 ? (
                            <Check width={12} height={12} strokeWidth={2.5} />
                          ) : (
                            <Plus width={12} height={12} strokeWidth={2.5} />
                          )
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="inline-card-search-preview-trigger"
                      aria-label={`Preview ${c.name}`}
                      onClick={() => setPreviewIndex(idx)}
                    >
                      {thumb !== undefined &&
                        (thumb ? (
                          <img
                            src={thumb}
                            alt=""
                            loading="lazy"
                            className="inline-card-search-thumb"
                          />
                        ) : (
                          <span
                            className="inline-card-search-thumb inline-card-search-thumb--ph"
                            aria-hidden
                          />
                        ))}
                      <span className="inline-card-search-name">{c.name}</span>
                    </button>
                    {c.mana_cost && (
                      <ManaCost cost={c.mana_cost} className="inline-card-search-mana" />
                    )}
                    {/* Meta + the printing toggle move to their own line together
                        under 480px (STYLE_GUIDE printing-picker note) — apart
                        the toggle's "Printing & finish" text is the widest
                        non-essential item on the row and squeezes the name
                        down to a couple of characters. */}
                    <span className="inline-card-search-trailing">
                      <span className="inline-card-search-meta">
                        <span className="inline-card-search-owned">
                          {c.set.toUpperCase()} #{c.collector_number}
                        </span>
                        {!addToList && added > 0 && (
                          <span className="inline-card-search-added">Added ×{added}</span>
                        )}
                        {!addToList && canUndo && (
                          <IconButton
                            className="inline-card-search-undo"
                            onClick={() => undoAdd(c.id)}
                            label={`Remove last added copy of ${c.name}`}
                            icon={<Minus width={12} height={12} strokeWidth={2.5} />}
                          />
                        )}
                        {owned > 0 && (
                          <span className="inline-card-search-owned">{ownedLabel(owned)}</span>
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
                    </span>
                  </div>
                  {printingsOpen && (
                    <PrintingPicker
                      cardName={c.name}
                      fallback={c}
                      showExtras={addToList || !onAdd}
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
        {addToList && (
          <div role="status" aria-live="polite" className="inline-card-search-sr-only">
            {addListAnnouncement}
          </div>
        )}

        {pageSize !== undefined && results.length > shown.length && (
          <button
            type="button"
            className="inline-card-search-more"
            onClick={() => setVisible((v) => v + (pageSize ?? DEFAULT_PAGE))}
          >
            Show {Math.min(pageSize ?? DEFAULT_PAGE, results.length - shown.length)} more
          </button>
        )}
        {/* The stack holds at most `results.length` (the fetcher's own cap), so
            when the search matched more than that it has to say so — a count
            that only describes the fetched-but-hidden rows implies the fetch
            is the whole answer (board E341). */}
        {total !== null && total > results.length && (
          <p className="inline-card-search-total">
            Showing {Math.min(shown.length, results.length).toLocaleString()} of{' '}
            {total.toLocaleString()} matches. Narrow the search to see the rest.
          </p>
        )}

        {previewIndex !== null && previewCards[previewIndex] && (
          <CardPreview
            source="search"
            cards={previewCards}
            index={previewIndex}
            binderName=""
            sectionLabels={previewLabels}
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
              const added = addToList ? listQtyFor(card) : (addedCounts[card.id] ?? 0);
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
                    showExtras={addToList || !onAdd}
                    onAdd={(printing, finish, extras) =>
                      void addPrinting(card, printing, finish, extras)
                    }
                  />
                </div>
              );
            }}
          />
        )}
      </>
    );
  }
);
