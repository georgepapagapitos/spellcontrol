import { logger } from '@/lib/logger';
import { isApplyingServer } from '../lib/applying-server';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ScryfallCard } from '@/deck-builder/types';
import type {
  BinderDef,
  BinderInput,
  BinderReviewSnapshot,
  Condition,
  EnrichedCard,
  Finish,
  ListDef,
  ListEntry,
  UploadResponse,
} from '../types';
import { useDecksStore } from './decks';
import { useCubeStore } from './cube';
import {
  saveCollection,
  SaveCollectionError,
  loadCollection,
  clearCollection,
  type ImportHistoryEntry,
  type StoredCollection,
} from '../lib/local-cards';
import { applyPrices, setPrices, priceKey } from '../lib/card-prices';
import { buildBackup, type Backup } from '../lib/backup';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import { apiUrl } from '../lib/api-base';
import { SAMPLE_BINDERS, SAMPLE_IMPORT_LABEL } from '../lib/samples';
import { compileFilterGroups, cardMatchesAnyGroup, areAllGroupsEmpty } from '../lib/rules';
import { reconcileBinderRefs, addRef, removeRef, setOrderRefs } from '../lib/binder-refs';
import { acknowledgeInSnapshot } from '../lib/binder-drift';
import { computeBinderMoves, formatBinderMoveMessage, type BinderMove } from '../lib/binder-moves';
import { recordValueSnapshot } from '../lib/value-history';
import { bindersUseTags, decorateWithTags, ensureCardTags } from '../lib/card-tags';
import { buildAllocationMap } from '../lib/allocations';
import { remapCubeAllocations } from '../lib/remap-cube-allocations';
import { appNavigate } from '../lib/navigate-bridge';
import { MAX_VISIBLE_TOASTS } from '../lib/toast-stack';
import { clampListName, entryToCards, makeListEntry } from '../lib/lists';
import {
  captureCollectionSnapshot,
  snapshotHasContent,
  type CollectionSnapshot,
} from '../lib/collection-snapshot';
import { toast } from './toasts';

function newBinderId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `bndr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function newImportId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `imp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export type ImportMode = 'replace' | 'merge' | 'binder';

// Prices come from Scryfall, which refreshes at most once every 24h, so a
// card priced less than a day ago is as fresh as it can be — no point asking
// again. A card is "stale" once its pricedAt is older than this (or missing).
const PRICE_STALE_MS = 24 * 60 * 60 * 1000;
// Floor between auto-refresh *attempts*, so a failed/offline try (or a fast
// remount) can't thrash the endpoint. Device-local — see PRICE_REFRESH_LS_KEY.
const PRICE_REFRESH_RETRY_MS = 60 * 60 * 1000;
// Throttle timestamp lives in localStorage, NOT the synced store: "when did
// THIS device last try a price refresh" is a device concern and must never
// ride the sync path (it would clobber another device's clock for no reason).
const PRICE_REFRESH_LS_KEY = 'spellcontrol:lastPriceAutoRefreshAttempt';

interface CollectionState {
  cards: EnrichedCard[];
  fileName: string;
  scryfallHits: number;
  scryfallMisses: number;
  uploadedAt: number | null;
  /** Names of cards that couldn't be resolved by Scryfall on the most recent import. */
  unresolvedNames: string[];
  /**
   * Rows the most recent import withheld because the card service was
   * unreachable — NOT imported, retryable via importRows(). Session-local
   * (like unresolvedNames): a stale retry list after reload would be wrong.
   */
  fetchErrors: import('../types').FetchErrorRow[];
  /** Format detected by the most recent import (manabox / mtga / plain / etc). */
  detectedFormat: string;
  /** Chronological list of imports that built up the current collection. */
  importHistory: ImportHistoryEntry[];

  hydrating: boolean;
  isLoading: boolean;
  /** True while a /api/refresh-prices request is in flight. */
  isRefreshingPrices: boolean;
  /**
   * Chunk progress of an in-flight manual price refresh, so a global indicator
   * can show "Refreshing prices (3/12)…" after the user navigates away from
   * Settings. null when no refresh is running (or for a single-chunk run we
   * still set it so the count reads 0/1→1/1). Device-local, not synced.
   */
  priceRefreshProgress: { done: number; total: number } | null;
  error: string | null;

  binders: BinderDef[];
  lists: ListDef[];
  activeTab: string;
  editingBinder: string | null;
  editingBinderSeed: {
    name?: string;
    groups?: import('../types').BinderFilterGroup[];
    flagged?: string[];
  } | null;

  search: string;

  // Card actions
  hydrateCards: () => Promise<void>;
  /** Returns the importId that was stamped on the newly added cards, so the
   *  caller can correlate them with the routing summary or any other
   *  per-import affordance. */
  importCards: (
    response: UploadResponse,
    fileName: string,
    mode: ImportMode,
    options?: {
      isSample?: boolean;
      binderName?: string;
      binderColor?: string;
    }
  ) => Promise<string>;
  /**
   * Removes the import history entry with the given id and any cards stamped
   * with that importId. No-op if the id is unknown. Cards that predate the
   * importId field are never matched, so legacy data is left alone.
   */
  deleteImports: (ids: string[]) => Promise<void>;
  /**
   * Refreshes Scryfall market prices for the given scryfallIds (or every unique id
   * in the collection when called with no args). Updates purchasePrice and pricedAt
   * in place, persists, and toggles isRefreshingPrices around the request.
   *
   * Re-throws on failure so the caller can show a truthful toast. Pass
   * `{ track: true }` for a user-initiated refresh to surface chunk progress
   * (drives the global "Refreshing prices (n/m)…" pill); the silent background
   * auto-refresh leaves it off so it never flashes on boot.
   */
  refreshPrices: (scryfallIds?: string[], opts?: { track?: boolean }) => Promise<void>;
  /**
   * Silently refreshes prices when they've gone stale (>24h old or missing),
   * delegating to refreshPrices(). Self-gating and safe to call on every boot:
   * no-ops when there are no cards, when offline, when a refresh is already
   * running, when nothing is stale, or when another attempt fired within the
   * retry window. Throttle is device-local (localStorage), never synced.
   */
  autoRefreshStalePrices: () => Promise<void>;
  /**
   * Updates a single card in the collection by copyId. Replaces any provided
   * fields on the matching EnrichedCard, persists to IndexedDB, and preserves
   * the original copyId so deck allocations remain intact.
   */
  updateCard: (copyId: string, updates: Partial<Omit<EnrichedCard, 'copyId'>>) => Promise<void>;
  /**
   * Replaces the cards array wholesale. Used by the edit-card flow when
   * changing quantity (which adds new copies or removes existing ones) so
   * the caller can compute the new array and persist in one round-trip.
   */
  replaceAllCards: (cards: EnrichedCard[]) => Promise<void>;
  /**
   * Adds one or more copies of a card to the collection from a Scryfall card
   * object. Each copy gets a fresh copyId; optional per-copy details
   * (condition/language) are stamped on all of them. Persists once. Returns
   * the new copyIds so callers can pin them to a binder in the same action.
   */
  addCard: (
    card: ScryfallCard,
    finish?: Finish,
    extras?: { quantity?: number; condition?: Condition; language?: string }
  ) => Promise<string[]>;
  clearCards: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (err: string | null) => void;

  // Backup actions
  buildBackupSnapshot: () => Backup;
  restoreFromBackup: (backup: Backup) => Promise<void>;
  /**
   * Restore a {@link CollectionSnapshot} captured before a destructive op
   * (clear / delete-import / replace-import). Sets the collection slice back and
   * lets deck allocations + binder refs self-heal from the restored cards, then
   * persists. Backs the "Undo" toast those ops surface.
   */
  restoreCollectionSnapshot: (snap: CollectionSnapshot) => Promise<void>;

  // Binder card customization actions
  /** Add a card to a binder's pinned list. No-op if already pinned. Returns true if added. */
  pinCardToBinder: (binderId: string, copyId: string) => boolean;
  /** Review-queue "Keep it here": pins a card to a binder like `pinCardToBinder`,
   *  but never auto-flips the binder into manual mode — this is a targeted
   *  "deny this one removal", not an editing action on the whole binder. */
  keepCardInBinder: (binderId: string, copyId: string) => void;
  /** Remove a card from a binder. If the card is pinned, removes from pinnedCopyIds.
   *  If rule-matched, adds to excludedCopyIds so it stays hidden even if rules still match. */
  removeCardFromBinder: (binderId: string, copyId: string, isRuleMatched: boolean) => void;
  /** Restore a previously excluded card (remove from excludedCopyIds). */
  restoreExcludedCard: (binderId: string, copyId: string) => void;
  /** Review-queue "Added it" / "Moved it": acknowledges a single drifted card into the
   *  binder's review baseline without recapturing the whole binder. No-op if
   *  the binder has no baseline yet. See lib/binder-drift.ts:acknowledgeInSnapshot. */
  acknowledgeBinderCard: (
    binderId: string,
    key: string,
    direction: 'added' | 'removed',
    card?: EnrichedCard
  ) => void;
  /** Switch a binder between rules and manual mode. */
  setBinderMode: (binderId: string, mode: 'rules' | 'manual') => void;
  /** Set the explicit card order. Pass undefined to revert to auto-sort. */
  setBinderManualOrder: (binderId: string, order: string[] | undefined) => void;
  /** Snapshot the current sorted order as the manual order. */
  seedManualOrder: (binderId: string, currentCardIds: string[]) => void;

  // List actions
  createList: (name: string) => string;
  renameList: (id: string, name: string) => void;
  reorderLists: (orderedIds: string[]) => void;
  deleteList: (id: string) => void;
  /** Delete a set of lists in one shot (bulk-select). */
  deleteLists: (ids: string[]) => void;
  deleteAllLists: () => void;
  addListEntry: (
    listId: string,
    card: Parameters<typeof makeListEntry>[0],
    quantity?: number
  ) => Promise<void>;
  /**
   * Bulk-add cards to a list in one mutation (one persist, not N). Dedups by
   * printing+finish against the list's existing entries so re-saving a filtered
   * collection group doesn't pile up duplicate rows. Returns how many were
   * added vs. skipped as already present.
   */
  addListEntries: (
    listId: string,
    cards: Array<{ card: Parameters<typeof makeListEntry>[0]; quantity?: number }>
  ) => Promise<{ added: number; skipped: number }>;
  updateListEntry: (
    listId: string,
    entryId: string,
    patch: Partial<{
      quantity: number;
      note: string;
      targetPrice: number;
      scryfallId: string;
      setCode: string;
      collectorNumber: string;
      finish: import('../types').Finish;
    }>
  ) => Promise<void>;
  removeListEntry: (listId: string, entryId: string) => Promise<void>;
  moveListEntryToCollection: (listId: string, entryId: string) => Promise<void>;
  /** Persists the full current collection blob (cards + lists). */
  persistCollection: () => Promise<void>;

  // Binder actions
  /**
   * Creates the sample binder defs (tagged isSample on BinderDef). When
   * `importResponse` is provided, the bundled starter pack is also imported
   * (tagged isSample in import history). Pass `null` to load just the binders
   * — used when the user already has a real collection and only wants the
   * curated rule examples to filter against their own cards.
   * Returns the created binder ids so the caller can switch the active tab.
   */
  loadSampleBinders: (importResponse: UploadResponse | null) => Promise<string[]>;
  createBinder: (input: BinderInput) => BinderDef;
  updateBinder: (id: string, input: Partial<BinderInput>) => void;
  /** Stamps a snapshot of the binder's current membership + volatile field
   *  values (price, edhrecRank) so the next view can diff against it and
   *  surface drift. See `lib/binder-drift.ts`. */
  markBinderReviewed: (id: string, snapshot: BinderReviewSnapshot) => void;
  deleteBinder: (id: string) => void;
  /** Delete a set of binders in one shot (bulk-select). Positions renumber; cards re-route. */
  deleteBinders: (ids: string[]) => void;
  /** Removes every binder. Cards are unaffected — they fall back to Uncategorized. */
  deleteAllBinders: () => void;
  moveBinder: (id: string, direction: 'up' | 'down') => void;

  // UI actions
  setActiveTab: (tab: string) => void;
  setEditingBinder: (
    id: string | null,
    seed?: { name?: string; groups?: import('../types').BinderFilterGroup[]; flagged?: string[] }
  ) => void;

  // Config actions
  setSearch: (s: string) => void;
}

/**
 * Merges a new batch of cards with the existing set. Cards are considered duplicates if they
 * share name + setCode + collectorNumber + foil. Quantity-as-rows model means each physical
 * card is one entry, so "merging" actually concatenates them — duplicates remain because a
 * collection genuinely can have N copies of the same printing.
 *
 * In other words: merge = append. There's no per-card dedup; if you re-import the same CSV in
 * merge mode, you'll see double the cards. The user's responsibility is to import incremental
 * adds (a single pack, a recent purchase) rather than full collection re-exports.
 */
function mergeCards(existing: EnrichedCard[], incoming: EnrichedCard[]): EnrichedCard[] {
  return [...existing, ...incoming];
}

function buildStored(s: {
  cards: EnrichedCard[];
  fileName: string;
  scryfallHits: number;
  scryfallMisses: number;
  uploadedAt: number | null;
  importHistory: ImportHistoryEntry[];
  lists: ListDef[];
}): StoredCollection {
  return {
    cards: s.cards,
    fileName: s.fileName,
    scryfallHits: s.scryfallHits,
    scryfallMisses: s.scryfallMisses,
    uploadedAt: s.uploadedAt ?? Date.now(),
    importHistory: s.importHistory,
    lists: s.lists,
  };
}

function remapDeckAllocations(newCards: EnrichedCard[]): void {
  const { decks, remapAllocations } = useDecksStore.getState();
  if (decks.length > 0) {
    remapAllocations(newCards);
  }
  // Physical cubes claim copies too — re-resolve their bindings on the same
  // collection-replace so a reimport doesn't orphan them (no-op if none exist).
  remapCubeAllocations(newCards);
}

/**
 * Binder analogue of remapDeckAllocations: re-resolve every binder's pins /
 * exclusions / manual order from their durable natural-key shadow against the
 * new collection.
 * `prevCards` is the collection BEFORE this mutation (still needed to backfill
 * legacy binders that predate the shadow). No-ops cleanly — only writes
 * `binders` when something actually changed, preserving the array reference so
 * the sync subscriber doesn't see a phantom mutation.
 */
function remapBinderRefs(prevCards: EnrichedCard[], newCards: EnrichedCard[]): void {
  const { binders } = useCollectionStore.getState();
  if (binders.length === 0) return;
  const result = reconcileBinderRefs(binders, newCards, prevCards);
  if (result.changed) useCollectionStore.setState({ binders: result.binders });
}

/**
 * Call both remap helpers in the correct order whenever the collection
 * cards array changes wholesale (import / delete / restore / clear).
 * `prev` is the cards array BEFORE the mutation; `next` is after.
 */
function remapCollectionDependents(prev: EnrichedCard[], next: EnrichedCard[]): void {
  remapDeckAllocations(next);
  remapBinderRefs(prev, next);
}

/** Open a binder from a toast action: select its tab, then route to it. */
function openBinder(binderId: string): void {
  useCollectionStore.getState().setActiveTab(binderId);
  appNavigate(`/collection/binders/${binderId}`);
}

/**
 * Surface binder auto-moves that a price refresh caused (T21 / E5). Binders are
 * rule-based, so a price crossing a threshold silently moves a card in or out —
 * this tells the user it happened. Per-move toasts (coalescing identical ones)
 * up to the viewport cap; beyond that, a single digest so a big refresh doesn't
 * silently drop moves off the top of the stack. Info tone; moves INTO a binder
 * carry a "View binder" action to the destination.
 */
function notifyBinderMoves(moves: BinderMove[]): void {
  if (moves.length === 0) return;

  if (moves.length > MAX_VISIBLE_TOASTS) {
    toast.show({
      message: `${moves.length} cards moved between binders (prices updated).`,
      tone: 'info',
      actionLabel: 'View',
      onAction: () => appNavigate('/collection/binders'),
    });
    return;
  }

  for (const move of moves) {
    const message = formatBinderMoveMessage(move);
    const dest = move.toBinder;
    if (dest) {
      toast.show({
        message,
        tone: 'info',
        actionLabel: 'View binder',
        onAction: () => openBinder(dest.id),
      });
    } else {
      // Left a binder for the Uncategorized remainder — no destination to open,
      // so keep it a plain toast (which also lets identical moves coalesce).
      toast.show({ message, tone: 'info' });
    }
  }
}

/**
 * Persists only the lists kind. Used by list-only mutators so they don't
 * fan out to cards + importHistory unnecessarily (those are unchanged and
 * the per-row diff in persistKind would skip them anyway, but we avoid the
 * redundant IDB reads entirely). Mirrors the lazy-import pattern used by
 * the collection subscriber so the store→sync cycle stays broken.
 */
async function persistListsOnly(lists: ReadonlyArray<{ id: string }>): Promise<void> {
  try {
    const sync = await import('../lib/sync');
    await sync.persistListsState(lists);
  } catch (err) {
    logger.warn('[store] Failed to persist lists:', err);
  }
}

export const useCollectionStore = create<CollectionState>()(
  persist(
    (set, get) => ({
      cards: [],
      fileName: '',
      scryfallHits: 0,
      scryfallMisses: 0,
      uploadedAt: null,
      unresolvedNames: [],
      fetchErrors: [],
      detectedFormat: '',
      importHistory: [],
      hydrating: true,
      isLoading: false,
      isRefreshingPrices: false,
      priceRefreshProgress: null,
      error: null,
      activeTab: 'uncategorized',
      editingBinder: null,
      editingBinderSeed: null,
      search: '',

      // Persisted defaults
      binders: [],
      lists: [],

      // Card actions
      hydrateCards: async () => {
        try {
          const stored = await loadCollection();
          if (stored) {
            set({
              cards: stored.cards,
              fileName: stored.fileName,
              scryfallHits: stored.scryfallHits,
              scryfallMisses: stored.scryfallMisses,
              uploadedAt: stored.uploadedAt,
              importHistory: stored.importHistory,
              lists: stored.lists,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to load saved collection.';
          set({ error: msg });
        } finally {
          set({ hydrating: false });
          const cards = get().cards;
          if (cards.length > 0) {
            remapDeckAllocations(cards);
          }
        }
      },

      importCards: async (response, fileName, mode, options) => {
        const uploadedAt = Date.now();
        const importId = newImportId();
        const existing = get().cards;
        const existingHistory = get().importHistory;
        const stamped = response.cards.map((c) => ({ ...c, importId }));
        const collectionMode = mode === 'binder' ? 'merge' : mode;
        const newCards = collectionMode === 'merge' ? mergeCards(existing, stamped) : stamped;
        // A 'replace' import over a non-empty collection silently discards the
        // prior cards/history — snapshot it so we can offer an Undo. (First
        // imports and merges add rather than destroy, so they need none.)
        const replacedSnapshot =
          collectionMode === 'replace' && existing.length > 0
            ? captureCollectionSnapshot(get())
            : null;
        const entry: ImportHistoryEntry = {
          id: importId,
          name: fileName,
          count: response.cards.length,
          format: response.detectedFormat,
          addedAt: uploadedAt,
          ...(options?.isSample ? { isSample: true } : {}),
        };
        const importHistory =
          collectionMode === 'merge' && existing.length > 0 ? [...existingHistory, entry] : [entry];

        const stateUpdate: Partial<CollectionState> = {
          cards: newCards,
          fileName,
          scryfallHits: response.scryfallHits,
          scryfallMisses: response.scryfallMisses,
          unresolvedNames: response.unresolvedNames,
          fetchErrors: response.fetchErrors,
          detectedFormat: response.detectedFormat,
          uploadedAt,
          importHistory,
          error: null,
        };

        if (mode === 'binder' && options?.binderName) {
          const copyIds = stamped.map((c) => c.copyId);
          const now = Date.now();
          const binder: BinderDef = {
            id: newBinderId(),
            name: options.binderName,
            position: get().binders.length,
            filterGroups: [{ filter: {} }],
            sorts: [],
            pocketSize: null,
            doubleSided: false,
            fixedCapacity: null,
            color: options.binderColor ?? '#6366f1',
            // Imported binders hold exactly the imported copies — 'manual' so
            // the empty filterGroups can't vacuum unrelated collection cards.
            mode: 'manual',
            pinnedCopyIds: copyIds,
            manualOrder: copyIds,
            createdAt: now,
            updatedAt: now,
          };
          stateUpdate.binders = [...get().binders, binder];
          stateUpdate.activeTab = binder.id;
        }

        set(stateUpdate);

        // Re-resolve binder pins/exclusions from their durable key shadow. This
        // is the headline recovery path: re-uploading a CSV after a cache/sync
        // loss mints new copyIds, and this re-binds the user's pins to the
        // equivalent new copies instead of silently dropping them.
        remapCollectionDependents(existing, newCards);

        try {
          await saveCollection(
            buildStored({
              cards: newCards,
              fileName,
              scryfallHits: response.scryfallHits,
              scryfallMisses: response.scryfallMisses,
              uploadedAt,
              importHistory,
              lists: get().lists,
            })
          );
        } catch (err) {
          logger.warn('[store] Failed to persist collection:', err);
          // Only claim total loss when the CARDS row itself failed; a failure
          // limited to imports/lists means the cards are safely stored (F25).
          const failed = err instanceof SaveCollectionError ? err.kinds : ['cards'];
          set({
            error: failed.includes('cards')
              ? "Cards imported but couldn't be saved locally. They will be lost if you refresh the page."
              : `Cards imported, but some data (${failed.join(', ')}) couldn't be saved locally.`,
          });
        }
        if (replacedSnapshot) {
          toast.show({
            message: 'Collection replaced on import.',
            tone: 'success',
            actionLabel: 'Undo',
            onAction: () => {
              void get().restoreCollectionSnapshot(replacedSnapshot);
            },
          });
        }
        return importId;
      },

      deleteImports: async (ids) => {
        if (ids.length === 0) return;
        const snap = captureCollectionSnapshot(get());
        const idSet = new Set(ids);
        const s = get();
        const remainingCards = s.cards.filter((c) => !c.importId || !idSet.has(c.importId));
        const remainingHistory = s.importHistory.filter((h) => !idSet.has(h.id));
        const removedCount = s.cards.length - remainingCards.length;
        set({
          cards: remainingCards,
          importHistory: remainingHistory,
          // Drop top-level metadata that referred to a since-removed import.
          ...(remainingHistory.length === 0
            ? {
                fileName: '',
                scryfallHits: 0,
                scryfallMisses: 0,
                uploadedAt: null,
                unresolvedNames: [],
                fetchErrors: [],
                detectedFormat: '',
              }
            : {}),
        });
        if (remainingCards.length < s.cards.length) {
          remapCollectionDependents(s.cards, remainingCards);
        }
        try {
          if (remainingCards.length === 0 && remainingHistory.length === 0) {
            await clearCollection();
          } else {
            await saveCollection(buildStored({ ...get() }));
          }
        } catch (err) {
          logger.warn('[store] Failed to persist after deleteImports:', err);
        }
        if (removedCount > 0) {
          toast.show({
            message: `Removed ${removedCount} card${removedCount === 1 ? '' : 's'}`,
            tone: 'success',
            actionLabel: 'Undo',
            onAction: () => {
              void get().restoreCollectionSnapshot(snap);
            },
          });
        }
      },

      updateCard: async (copyId, updates) => {
        const s = get();
        const updated = s.cards.map((c) =>
          c.copyId === copyId ? { ...c, ...updates, copyId, updatedAt: Date.now() } : c
        );
        set({ cards: updated });
        try {
          await saveCollection(buildStored({ ...get() }));
        } catch (err) {
          logger.warn('[store] Failed to persist card update:', err);
        }
      },

      replaceAllCards: async (cards) => {
        const s = get();
        const newCopyIds = new Set(cards.map((c) => c.copyId));
        const lostCopy = s.cards.some((c) => !newCopyIds.has(c.copyId));
        set({ cards });
        if (lostCopy) {
          remapCollectionDependents(s.cards, cards);
        }
        try {
          await saveCollection(buildStored({ ...get() }));
        } catch (err) {
          logger.warn('[store] Failed to persist after replaceAllCards:', err);
        }
      },

      addCard: async (card, finish, extras) => {
        const qty = Math.max(1, Math.floor(extras?.quantity ?? 1));
        const now = Date.now();
        const rows = Array.from({ length: qty }, () => {
          const enriched = { ...scryfallToEnrichedCard(card, finish), updatedAt: now };
          if (extras?.condition) enriched.condition = extras.condition;
          if (extras?.language) enriched.language = extras.language;
          return enriched;
        });
        set({ cards: [...get().cards, ...rows] });
        try {
          await saveCollection(buildStored({ ...get() }));
        } catch (err) {
          logger.warn('[store] Failed to persist after addCard:', err);
        }
        return rows.map((r) => r.copyId);
      },

      refreshPrices: async (scryfallIds, opts) => {
        // Only a user-initiated refresh surfaces the progress pill; the silent
        // boot auto-refresh leaves `track` off so it never flashes on launch.
        const track = opts?.track ?? false;
        const s = get();
        if (s.cards.length === 0) return;

        const ids =
          scryfallIds && scryfallIds.length > 0
            ? Array.from(new Set(scryfallIds.filter(Boolean)))
            : Array.from(new Set(s.cards.map((c) => c.scryfallId).filter(Boolean)));
        if (ids.length === 0) return;

        const totalChunks = Math.ceil(ids.length / 1000);
        set({
          isRefreshingPrices: true,
          priceRefreshProgress: track ? { done: 0, total: totalChunks } : null,
        });
        try {
          // The server caps each request at 1000 printings, so page through the
          // collection in chunks. Without this, a large collection only ever
          // prices its first 1000 unique printings — and *which* 1000 depends on
          // array order, so two devices price different subsets and show $0 on
          // different cards. priceLimiter is 30 req/min, so even a ~20k-printing
          // collection (20 requests) stays well under the cap.
          const PRICE_CHUNK = 1000;
          // The server returns a price per FINISH for each printing (foil and
          // non-foil of the same printing differ); each value is already
          // fallback-resolved server-side. `usdFoil`/`usdEtched` are absent from
          // a pre-finish server — those cards just degrade to the non-foil price.
          type FinishPrices = Record<
            string,
            { usd: number; usdFoil?: number; usdEtched?: number; pricedAt: number }
          >;
          // Fan a printing's per-finish prices out to finish-keyed cache entries.
          // Only positive values are written — a $0 finish (Scryfall has none)
          // stays unkeyed so the card keeps counting as stale rather than
          // freezing at $0.
          const fanOut = (src: FinishPrices): Record<string, { usd: number; pricedAt: number }> => {
            const e: Record<string, { usd: number; pricedAt: number }> = {};
            for (const [id, p] of Object.entries(src)) {
              if (p.usd > 0) e[priceKey(id, 'nonfoil')] = { usd: p.usd, pricedAt: p.pricedAt };
              if (p.usdFoil && p.usdFoil > 0)
                e[priceKey(id, 'foil')] = { usd: p.usdFoil, pricedAt: p.pricedAt };
              if (p.usdEtched && p.usdEtched > 0)
                e[priceKey(id, 'etched')] = { usd: p.usdEtched, pricedAt: p.pricedAt };
            }
            return e;
          };
          // Fetch one chunk, retrying a dropped CONNECTION a couple times before
          // giving up. Cold price lookups take tens of seconds, so a flaky mobile
          // link is likely to drop mid-request; without the retry the whole
          // refresh aborts. Only a network rejection retries — an HTTP error
          // (4xx/5xx) is surfaced immediately so a real server problem isn't
          // masked behind silent retries.
          const fetchChunk = async (batch: string[]): Promise<FinishPrices> => {
            let lastErr: unknown;
            for (let attempt = 0; attempt < 3; attempt++) {
              let res: Response;
              try {
                res = await fetch(apiUrl('/api/refresh-prices'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ scryfallIds: batch }),
                });
              } catch (err) {
                lastErr = err;
                if (attempt < 2) {
                  await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
                  continue;
                }
                throw err;
              }
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(body.error || `HTTP ${res.status}`);
              }
              return ((await res.json()) as { prices: FinishPrices }).prices;
            }
            throw lastErr;
          };

          // Accumulate across chunks for the final carry-over reconciliation, but
          // PERSIST each chunk to the device cache as it lands. A later chunk's
          // network drop must not discard prices we already fetched — that
          // all-or-nothing failure is what left a whole collection stuck at $0 on
          // a flaky connection. setPrices is idempotent, so the final write below
          // is a harmless no-op for chunks already stored here.
          // Snapshot binder membership BEFORE any price is applied this run — the
          // incremental per-chunk apply below mutates `cards`, so the auto-move
          // diff must compare against this pristine "before".
          const beforeCards = get().cards;
          const prices: FinishPrices = {};
          for (let i = 0; i < ids.length; i += PRICE_CHUNK) {
            const batchPrices = await fetchChunk(ids.slice(i, i + PRICE_CHUNK));
            Object.assign(prices, batchPrices);
            setPrices(fanOut(batchPrices));
            set({ cards: applyPrices(get().cards) });
            if (track)
              set({ priceRefreshProgress: { done: i / PRICE_CHUNK + 1, total: totalChunks } });
          }

          // Prices are device-local reference data — write them to the on-device
          // price cache (NOT the sync path) and re-merge onto the in-memory
          // cards. No enqueue, no server push, no IDB-synced-row write: a price
          // refresh must not touch sync at all (that was the ~12k-row re-push
          // churn + the boot OOM).
          const requested = new Set(ids);
          const now = Date.now();
          const entries = fanOut(prices);
          // For requested copies the server returned no price for, carry over a
          // POSITIVE last-known value (keyed by their own finish) with a fresh
          // pricedAt so a transient server miss doesn't flash $0. A copy whose
          // current price is $0 (never priced, or the server cache was cold when
          // this device last refreshed) is deliberately left UNSEEDED: stamping
          // it fresh would mark it "not stale" and freeze it at $0 forever, so
          // it must stay stale and get retried on the next refresh.
          for (const c of get().cards) {
            const id = c.scryfallId;
            if (!id || !requested.has(id)) continue;
            const key = priceKey(id, c.finish);
            if (!(key in entries) && (c.purchasePrice ?? 0) > 0) {
              entries[key] = { usd: c.purchasePrice as number, pricedAt: now };
            }
          }
          setPrices(entries);
          const afterCards = applyPrices(get().cards);
          set({ cards: afterCards });

          // Rule-based binders re-route silently when a price crosses a
          // threshold — diff membership old↔new and tell the user what moved.
          // Allocations are passed through so the diff matches the live view
          // (copies hidden via hideDeckAllocated don't "move"). Device-local,
          // no sync touched.
          const allocated = new Set(
            buildAllocationMap(useDecksStore.getState().decks, useCubeStore.getState().saved).keys()
          );
          // Decorate with oracle tags so moves into/out of a tag-ruled binder
          // are detected (no-op unless a binder uses one). Tags are name-derived
          // and price-invariant, so this only matters when a tag binder's
          // membership hinges on routing priority against a price-ruled binder.
          const moveBinders = get().binders;
          let beforeForMoves = beforeCards;
          let afterForMoves = afterCards;
          if (bindersUseTags(moveBinders)) {
            await ensureCardTags();
            beforeForMoves = decorateWithTags(beforeCards);
            afterForMoves = decorateWithTags(afterCards);
          }
          notifyBinderMoves(
            computeBinderMoves(beforeForMoves, afterForMoves, moveBinders, {
              allocatedCopyIds: allocated,
            })
          );

          // E76 value pulse: log today's total value into the device-local
          // history (one point per day, never synced). Piggybacks this tick
          // because prices move at most daily — never a server cron. Best
          // effort: a missing/blocked IndexedDB must not fail the refresh.
          recordValueSnapshot(afterCards.reduce((sum, c) => sum + (c.purchasePrice ?? 0), 0)).catch(
            () => {}
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to refresh prices.';
          logger.warn('[store] refreshPrices failed:', err);
          set({ error: msg });
          // Re-throw so callers can tell success from failure. SettingsPage's
          // handler shows a truthful success/error toast; the lone background
          // caller (autoRefreshStalePrices) swallows it. Without this, a failed
          // refresh resolved cleanly and lit the "Prices refreshed." toast.
          throw err instanceof Error ? err : new Error(msg);
        } finally {
          set({ isRefreshingPrices: false, priceRefreshProgress: null });
        }
      },

      autoRefreshStalePrices: async () => {
        const s = get();
        if (s.cards.length === 0 || s.isRefreshingPrices) return;
        // Never reach for the network when we know we're offline. (navigator is
        // absent in the node test env; treat that as "online" so logic is testable.)
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

        const now = Date.now();
        // Stale if ANY card was priced over a day ago or has never been priced
        // (missing pricedAt → treated as epoch 0, i.e. maximally stale).
        const stale = s.cards.some((c) => now - (c.pricedAt ?? 0) > PRICE_STALE_MS);
        if (!stale) return;

        // Device-local attempt throttle: skip if we already tried recently, so a
        // failed/offline run (or a quick remount) can't hammer the endpoint.
        try {
          const last = Number(localStorage.getItem(PRICE_REFRESH_LS_KEY)) || 0;
          if (now - last < PRICE_REFRESH_RETRY_MS) return;
          localStorage.setItem(PRICE_REFRESH_LS_KEY, String(now));
        } catch {
          // localStorage unavailable (private mode / SSR) — fall through and
          // still refresh; the in-flight isRefreshingPrices guard prevents overlap.
        }

        // A fresh device that just synced has a whole collection of unpriced
        // ($0) cards; show the progress pill on that first fill so it reads as
        // "Refreshing prices" instead of a silent wall of $0 (the thing that
        // looked broken). Routine daily staleness — where most cards are
        // already priced — stays silent so the pill never flashes on a normal
        // launch.
        const noPrices = s.cards.every((c) => !((c.purchasePrice ?? 0) > 0));

        // Background best-effort: refreshPrices now re-throws on failure, but a
        // stale-price auto-refresh must never surface an error toast or an
        // unhandled rejection. The error is already logged + stored in `error`.
        try {
          await get().refreshPrices(undefined, { track: noPrices });
        } catch {
          // swallowed — the next stale check (or a manual refresh) retries.
        }
      },

      clearCards: async () => {
        const snap = captureCollectionSnapshot(get());
        const prevCards = get().cards;
        set({
          cards: [],
          fileName: '',
          scryfallHits: 0,
          scryfallMisses: 0,
          uploadedAt: null,
          unresolvedNames: [],
          fetchErrors: [],
          detectedFormat: '',
          importHistory: [],
          error: null,
        });
        // Empties each binder's resolved pinnedCopyIds but RETAINS the durable
        // pinnedKeys, so re-importing the same collection restores the pins
        // rather than clearing them forever.
        remapCollectionDependents(prevCards, []);
        try {
          await clearCollection();
        } catch (err) {
          logger.warn('[store] Failed to clear cache:', err);
        }
        // Offer one-shot undo of this hard-to-reverse wipe.
        if (snapshotHasContent(snap)) {
          toast.show({
            message: 'Collection cleared.',
            tone: 'success',
            actionLabel: 'Undo',
            onAction: () => {
              void get().restoreCollectionSnapshot(snap);
            },
          });
        }
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setError: (err) => set({ error: err }),

      buildBackupSnapshot: () => {
        const s = get();
        const collection: StoredCollection | null =
          s.cards.length > 0
            ? {
                cards: s.cards,
                fileName: s.fileName,
                scryfallHits: s.scryfallHits,
                scryfallMisses: s.scryfallMisses,
                uploadedAt: s.uploadedAt ?? Date.now(),
                importHistory: s.importHistory,
                lists: s.lists,
              }
            : null;
        return buildBackup(collection, s.binders);
      },

      restoreFromBackup: async (backup) => {
        const collection = backup.collection;
        const uploadedAt = collection?.uploadedAt ?? Date.now();
        const restoredHistory: ImportHistoryEntry[] = collection?.importHistory ?? [];
        const prevCards = get().cards;

        set({
          cards: collection?.cards ?? [],
          fileName: collection?.fileName ?? '',
          scryfallHits: collection?.scryfallHits ?? 0,
          scryfallMisses: collection?.scryfallMisses ?? 0,
          unresolvedNames: [],
          fetchErrors: [],
          detectedFormat: '',
          uploadedAt: collection ? uploadedAt : null,
          importHistory: restoredHistory,
          lists: collection?.lists ?? [],
          binders: backup.binders,
          activeTab: backup.binders[0]?.id ?? 'uncategorized',
          error: null,
        });

        remapCollectionDependents(prevCards, collection?.cards ?? []);

        if (collection) {
          try {
            await saveCollection(buildStored({ ...get() }));
          } catch (err) {
            logger.warn('[store] Failed to persist restored collection:', err);
            set({
              error:
                "Backup restored to memory but couldn't be saved locally. It will be lost if you refresh the page.",
            });
          }
        } else {
          try {
            await clearCollection();
          } catch (err) {
            logger.warn('[store] Failed to clear cache during restore:', err);
          }
        }
      },

      restoreCollectionSnapshot: async (snap) => {
        const prevCards = get().cards;
        set({
          cards: snap.cards,
          fileName: snap.fileName,
          scryfallHits: snap.scryfallHits,
          scryfallMisses: snap.scryfallMisses,
          unresolvedNames: snap.unresolvedNames,
          // Snapshots predate/omit the retry bucket — a restored collection has
          // no pending degraded import to retry.
          fetchErrors: [],
          detectedFormat: snap.detectedFormat,
          uploadedAt: snap.uploadedAt,
          importHistory: snap.importHistory,
          lists: snap.lists,
          error: null,
        });
        // Deck allocations and binder pins re-derive deterministically from the
        // restored cards (binders keep their durable key shadow), so restoring
        // just the collection slice reproduces the prior deck/binder state —
        // same self-healing path as importCards / restoreFromBackup.
        remapCollectionDependents(prevCards, snap.cards);
        try {
          if (
            snap.cards.length === 0 &&
            snap.importHistory.length === 0 &&
            snap.lists.length === 0
          ) {
            await clearCollection();
          } else {
            await saveCollection(buildStored({ ...get() }));
          }
        } catch (err) {
          logger.warn('[store] Failed to persist restored collection:', err);
        }
      },

      // Binder card customization actions
      pinCardToBinder: (binderId, copyId) => {
        let added = false;
        const cards = get().cards;
        const card = cards.find((c) => c.copyId === copyId);
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            const existing = b.pinnedCopyIds ?? [];
            if (existing.includes(copyId)) return b;
            added = true;
            // Durable keys are the source of truth: append this copy's key and
            // re-derive ids. Never reconstructs keys from ids, so an existing
            // orphan-retained pin survives this mutation (the keysForIds bug).
            const { keys, ids } = addRef(b.pinnedKeys, existing, copyId, cards);
            const updated = {
              ...b,
              pinnedCopyIds: ids,
              pinnedKeys: keys,
              updatedAt: Date.now(),
            };
            if (b.mode !== 'manual' && card && !areAllGroupsEmpty(b.filterGroups)) {
              const compiled = compileFilterGroups(b.filterGroups);
              if (!cardMatchesAnyGroup(card, compiled)) {
                updated.mode = 'manual';
              }
            }
            return updated;
          }),
        }));
        return added;
      },

      keepCardInBinder: (binderId, copyId) => {
        const cards = get().cards;
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            const existing = b.pinnedCopyIds ?? [];
            if (existing.includes(copyId)) return b;
            // Same durable-key mechanics as pinCardToBinder, but deliberately
            // skips its manual-mode auto-flip: "Keep it here" is denying one
            // removal, not a signal that the binder's rules no longer fit.
            const { keys, ids } = addRef(b.pinnedKeys, existing, copyId, cards);
            return { ...b, pinnedCopyIds: ids, pinnedKeys: keys, updatedAt: Date.now() };
          }),
        }));
      },

      removeCardFromBinder: (binderId, copyId, isRuleMatched) => {
        const cards = get().cards;
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            if (isRuleMatched) {
              const excluded = b.excludedCopyIds ?? [];
              if (excluded.includes(copyId)) return b;
              // Exclude = add to the exclusion ref (same model as a pin).
              const { keys, ids } = addRef(b.excludedKeys, excluded, copyId, cards);
              return {
                ...b,
                excludedCopyIds: ids,
                excludedKeys: keys,
                updatedAt: Date.now(),
              };
            } else {
              // Drop this copy's slot from both the pin and manual-order refs:
              // one key occurrence each, every other key (incl. orphans) kept.
              const pin = removeRef(b.pinnedKeys, b.pinnedCopyIds, copyId, cards);
              const hasManual = (b.manualOrder?.length ?? 0) > 0 || (b.manualKeys?.length ?? 0) > 0;
              const man = hasManual ? removeRef(b.manualKeys, b.manualOrder, copyId, cards) : null;
              return {
                ...b,
                pinnedCopyIds: pin.ids,
                pinnedKeys: pin.keys,
                ...(man ? { manualOrder: man.ids, manualKeys: man.keys } : {}),
                updatedAt: Date.now(),
              };
            }
          }),
        }));
      },

      restoreExcludedCard: (binderId, copyId) => {
        const cards = get().cards;
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            const { keys, ids } = removeRef(b.excludedKeys, b.excludedCopyIds, copyId, cards);
            return {
              ...b,
              excludedCopyIds: ids,
              excludedKeys: keys,
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      acknowledgeBinderCard: (binderId, key, direction, card) => {
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId || !b.lastReviewedSnapshot) return b;
            return {
              ...b,
              lastReviewedSnapshot: acknowledgeInSnapshot(
                b.lastReviewedSnapshot,
                key,
                direction,
                card
              ),
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      setBinderMode: (binderId, mode) => {
        set((s) => ({
          binders: s.binders.map((b) =>
            b.id !== binderId ? b : { ...b, mode, updatedAt: Date.now() }
          ),
        }));
      },

      setBinderManualOrder: (binderId, order) => {
        const cards = get().cards;
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            if (!order) {
              // Clearing manual order → drop the durable shadow with it.
              return { ...b, manualOrder: undefined, manualKeys: undefined, updatedAt: Date.now() };
            }
            // Capture the durable key shadow at order time so a custom
            // arrangement survives a collection round-trip before the next
            // reconcile. Order is preserved exactly; keys mirror it 1:1.
            const { keys, ids } = setOrderRefs(order, cards);
            return { ...b, manualOrder: ids, manualKeys: keys, updatedAt: Date.now() };
          }),
        }));
      },

      seedManualOrder: (binderId, currentCardIds) => {
        const cards = get().cards;
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            const { keys, ids } = setOrderRefs(currentCardIds, cards);
            return { ...b, manualOrder: ids, manualKeys: keys, updatedAt: Date.now() };
          }),
        }));
      },

      // List actions
      createList: (name) => {
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `list-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const now = Date.now();
        const lists = get().lists;
        const def: ListDef = {
          id,
          name: clampListName(name) || 'Untitled',
          entries: [],
          order: lists.length,
          createdAt: now,
          updatedAt: now,
        };
        set({ lists: [...lists, def] });
        void persistListsOnly(get().lists);
        return id;
      },
      renameList: (id, name) => {
        set({
          lists: get().lists.map((l) =>
            l.id === id ? { ...l, name: clampListName(name) || l.name, updatedAt: Date.now() } : l
          ),
        });
        void persistListsOnly(get().lists);
      },
      reorderLists: (orderedIds) => {
        const byId = new Map(get().lists.map((l) => [l.id, l]));
        const reordered = orderedIds
          .map((id, i) => {
            const l = byId.get(id);
            return l ? { ...l, order: i } : null;
          })
          .filter((l): l is ListDef => l !== null);
        set({ lists: reordered });
        void persistListsOnly(get().lists);
      },
      deleteList: (id) => {
        set({
          lists: get()
            .lists.filter((l) => l.id !== id)
            .map((l, i) => ({ ...l, order: i })),
        });
        void persistListsOnly(get().lists);
      },
      deleteLists: (ids) => {
        const idSet = new Set(ids);
        set({
          lists: get()
            .lists.filter((l) => !idSet.has(l.id))
            .map((l, i) => ({ ...l, order: i })),
        });
        void persistListsOnly(get().lists);
      },
      deleteAllLists: () => {
        set({ lists: [] });
        void persistListsOnly([]);
      },
      addListEntry: async (listId, card, quantity) => {
        const entry = makeListEntry(card, quantity);
        set({
          lists: get().lists.map((l) =>
            l.id === listId ? { ...l, entries: [...l.entries, entry], updatedAt: Date.now() } : l
          ),
        });
        await persistListsOnly(get().lists);
      },
      addListEntries: async (listId, cards) => {
        const list = get().lists.find((l) => l.id === listId);
        if (!list) return { added: 0, skipped: 0 };
        // Dedup by printing+finish — the same identity the collection table
        // rolls duplicate copies into. finish is always set on a ListEntry, so
        // the nonfoil fallback only guards malformed legacy data.
        const keyOf = (e: Pick<ListEntry, 'scryfallId' | 'finish'>) =>
          `${e.scryfallId}:${e.finish ?? 'nonfoil'}`;
        const seen = new Set(list.entries.map(keyOf));
        const fresh: ListEntry[] = [];
        let skipped = 0;
        for (const { card, quantity } of cards) {
          const entry = makeListEntry(card, quantity ?? 1);
          const k = keyOf(entry);
          if (seen.has(k)) {
            skipped += 1;
            continue;
          }
          seen.add(k);
          fresh.push(entry);
        }
        if (fresh.length === 0) return { added: 0, skipped };
        set({
          lists: get().lists.map((l) =>
            l.id === listId ? { ...l, entries: [...l.entries, ...fresh], updatedAt: Date.now() } : l
          ),
        });
        await persistListsOnly(get().lists);
        return { added: fresh.length, skipped };
      },
      updateListEntry: async (listId, entryId, patch) => {
        set({
          lists: get().lists.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  updatedAt: Date.now(),
                  entries: l.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
                }
              : l
          ),
        });
        await persistListsOnly(get().lists);
      },
      removeListEntry: async (listId, entryId) => {
        set({
          lists: get().lists.map((l) =>
            l.id === listId
              ? { ...l, entries: l.entries.filter((e) => e.id !== entryId), updatedAt: Date.now() }
              : l
          ),
        });
        await persistListsOnly(get().lists);
      },
      moveListEntryToCollection: async (listId, entryId) => {
        const list = get().lists.find((l) => l.id === listId);
        const entry = list?.entries.find((e) => e.id === entryId);
        if (!entry) return;
        const newOwned = entryToCards(entry);
        const cards = [...get().cards, ...newOwned];
        set({
          cards,
          lists: get().lists.map((l) =>
            l.id === listId
              ? { ...l, entries: l.entries.filter((e) => e.id !== entryId), updatedAt: Date.now() }
              : l
          ),
        });
        remapDeckAllocations(cards);
        await get().persistCollection();
      },
      persistCollection: async () => {
        try {
          await saveCollection(buildStored({ ...get() }));
        } catch (err) {
          logger.warn('[store] Failed to persist collection:', err);
          set({
            error:
              "Change saved in memory but couldn't be saved locally. It will be lost if you refresh the page.",
          });
        }
      },

      // Binder actions
      loadSampleBinders: async (importResponse) => {
        // When an importResponse is supplied, add the bundled starter pack
        // alongside the binders (tagged isSample in history). Otherwise the
        // caller already has a real collection and only wants the binder defs.
        if (importResponse) {
          const mode: ImportMode = get().cards.length > 0 ? 'merge' : 'replace';
          await get().importCards(importResponse, SAMPLE_IMPORT_LABEL, mode, { isSample: true });
        }

        const now = Date.now();
        const startPosition = get().binders.length;
        const created: BinderDef[] = SAMPLE_BINDERS.map((tpl, i) => ({
          ...tpl.input,
          id: newBinderId(),
          position: startPosition + i,
          createdAt: now,
          updatedAt: now,
        }));
        set((s) => ({
          binders: [...s.binders, ...created],
          activeTab: created[0]?.id ?? s.activeTab,
        }));
        return created.map((b) => b.id);
      },

      createBinder: (input) => {
        const now = Date.now();
        const created: BinderDef = {
          ...input,
          id: newBinderId(),
          position: get().binders.length,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ binders: [...s.binders, created], activeTab: created.id }));
        return created;
      },

      updateBinder: (id, input) => {
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== id) return b;
            const next: BinderDef = { ...b, ...input, id: b.id, updatedAt: Date.now() };
            // Rule edits are intent, not drift: if a rules-mode binder's
            // filterGroups changed, the new membership IS the new baseline —
            // clear the snapshot so BinderDriftBanner's auto-baseline effect
            // re-stamps current membership on next view, instead of diffing
            // against rules that no longer apply.
            const isRulesMode = (input.mode ?? b.mode) !== 'manual';
            if (
              isRulesMode &&
              input.filterGroups !== undefined &&
              JSON.stringify(input.filterGroups) !== JSON.stringify(b.filterGroups)
            ) {
              next.lastReviewedSnapshot = undefined;
            }
            return next;
          }),
        }));
      },

      markBinderReviewed: (id, snapshot) => {
        set((s) => ({
          binders: s.binders.map((b) =>
            b.id === id ? { ...b, lastReviewedSnapshot: snapshot, updatedAt: Date.now() } : b
          ),
        }));
      },

      deleteBinder: (id) => {
        set((s) => {
          const now = Date.now();
          const remaining = s.binders
            .filter((b) => b.id !== id)
            .sort((a, b) => a.position - b.position)
            .map((b, i) => (b.position === i ? b : { ...b, position: i, updatedAt: now }));
          const newActive = s.activeTab === id ? remaining[0]?.id || 'uncategorized' : s.activeTab;
          return { binders: remaining, activeTab: newActive };
        });
      },

      deleteBinders: (ids) => {
        const idSet = new Set(ids);
        set((s) => {
          const now = Date.now();
          const remaining = s.binders
            .filter((b) => !idSet.has(b.id))
            .sort((a, b) => a.position - b.position)
            .map((b, i) => (b.position === i ? b : { ...b, position: i, updatedAt: now }));
          const newActive = idSet.has(s.activeTab)
            ? remaining[0]?.id || 'uncategorized'
            : s.activeTab;
          return { binders: remaining, activeTab: newActive };
        });
      },

      deleteAllBinders: () => {
        set({ binders: [], activeTab: 'uncategorized' });
      },

      moveBinder: (id, direction) => {
        set((s) => {
          const sorted = [...s.binders].sort((a, b) => a.position - b.position);
          const idx = sorted.findIndex((b) => b.id === id);
          if (idx === -1) return s;
          const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
          if (targetIdx < 0 || targetIdx >= sorted.length) return s;
          [sorted[idx], sorted[targetIdx]] = [sorted[targetIdx], sorted[idx]];
          const now = Date.now();
          const renumbered = sorted.map((b, i) =>
            b.position === i ? b : { ...b, position: i, updatedAt: now }
          );
          return { binders: renumbered };
        });
      },

      setActiveTab: (tab) => set({ activeTab: tab }),
      setEditingBinder: (id, seed) => set({ editingBinder: id, editingBinderSeed: seed ?? null }),

      setSearch: (s) => set({ search: s }),
    }),
    {
      name: 'spellcontrol',
      version: 15,
      storage: createJSONStorage(() => localStorage),
      // Synced data — including binders — lives in the per-entity IDB
      // (`entity-store`) and is rehydrated by `lib/sync.ts`. Nothing in this
      // store needs zustand-persist anymore; partialize returns an empty
      // object so the persist middleware writes nothing on mutation. The
      // middleware stays in place so any future UI-only field added to
      // `partialize` is one line of work, not a restructure.
      partialize: () => ({}),
    }
  )
);

/**
 * Sync subscriber for binder changes only. Cards / lists / importHistory are
 * persisted via the explicit `persistCollection()` call inside every mutator
 * that touches them (the legacy whole-blob path now routes through the per-
 * entity entity-store under the hood — see `lib/local-cards.ts`). Binders,
 * however, are mutated by sync helpers (`pinCardToBinder`, `setBinderMode`,
 * etc.) that don't run `persistCollection`, so we still need a subscriber
 * to fan binder changes into the per-row sync layer.
 *
 * `isApplyingServer()` short-circuits the path while sync.ts is writing
 * server-sourced state back into the store; otherwise we'd loop server
 * changes back to ourselves.
 */
useCollectionStore.subscribe((state, prev) => {
  if (state.binders === prev.binders) return;
  // Check the guard synchronously: subscribers fire synchronously during the
  // sync driver's setState, where the flag is set — but it would already be
  // reset by the time an async import('../lib/sync') resolved, which let pulled
  // state get re-persisted and re-pushed. Lazy-import only the persist call to
  // break the cycle (sync.ts imports the stores back). Errors must not bubble —
  // a missing IDB (tests) or network-down push must never crash the mutation;
  // the sync driver retries on next focus / online.
  if (isApplyingServer()) return;
  void import('../lib/sync')
    .then((sync) => sync.persistBindersState(state.binders))
    .catch(() => {});
});
