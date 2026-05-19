import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ScryfallCard } from '@/deck-builder/types';
import type {
  BinderDef,
  BinderInput,
  EnrichedCard,
  Finish,
  SubCollectionDef,
  UploadResponse,
} from '../types';
import { useDecksStore } from './decks';
import {
  saveCollection,
  loadCollection,
  clearCollection,
  type ImportHistoryEntry,
  type StoredCollection,
} from '../lib/local-cards';
import { buildBackup, normalizeSortEntries, type Backup } from '../lib/backup';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import { SAMPLE_BINDERS, SAMPLE_IMPORT_LABEL } from '../lib/samples';
import { compileFilterGroups, cardMatchesAnyGroup, areAllGroupsEmpty } from '../lib/rules';
import { markDestructive } from '../lib/sync-intent';
import { reconcileBinderRefs, keysForIds } from '../lib/binder-refs';
import {
  assignSubCollection,
  clampSubCollectionName,
  restoreSubCollectionAssignments,
} from '../lib/sub-collections';

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

interface CollectionState {
  cards: EnrichedCard[];
  fileName: string;
  scryfallHits: number;
  scryfallMisses: number;
  uploadedAt: number | null;
  /** Names of cards that couldn't be resolved by Scryfall on the most recent import. */
  unresolvedNames: string[];
  /** Format detected by the most recent import (manabox / mtga / plain / etc). */
  detectedFormat: string;
  /** Chronological list of imports that built up the current collection. */
  importHistory: ImportHistoryEntry[];

  hydrating: boolean;
  isLoading: boolean;
  /** True while a /api/refresh-prices request is in flight. */
  isRefreshingPrices: boolean;
  error: string | null;

  binders: BinderDef[];
  subCollections: SubCollectionDef[];
  activeTab: string;
  editingBinder: string | null;
  /** Whether the import bottom-sheet is open. Triggered by the small "+"
   * button on the OVERVIEW row of the Collection page. */
  importSheetOpen: boolean;

  search: string;

  // Card actions
  hydrateCards: () => Promise<void>;
  importCards: (
    response: UploadResponse,
    fileName: string,
    mode: ImportMode,
    options?: {
      isSample?: boolean;
      binderName?: string;
      binderColor?: string;
      subCollectionId?: string;
    }
  ) => Promise<void>;
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
   */
  refreshPrices: (scryfallIds?: string[]) => Promise<void>;
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
   * Adds a single card to the collection from a Scryfall card object.
   * Creates an EnrichedCard with a fresh copyId and persists. Returns the
   * new copyId so callers can pin it to a binder in the same action.
   */
  addCard: (card: ScryfallCard, finish?: Finish) => Promise<string>;
  clearCards: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (err: string | null) => void;

  // Backup actions
  buildBackupSnapshot: () => Backup;
  restoreFromBackup: (backup: Backup) => Promise<void>;

  // Binder card customization actions
  /** Add a card to a binder's pinned list. No-op if already pinned. Returns true if added. */
  pinCardToBinder: (binderId: string, copyId: string) => boolean;
  /** Remove a card from a binder. If the card is pinned, removes from pinnedCopyIds.
   *  If rule-matched, adds to excludedCopyIds so it stays hidden even if rules still match. */
  removeCardFromBinder: (binderId: string, copyId: string, isRuleMatched: boolean) => void;
  /** Restore a previously excluded card (remove from excludedCopyIds). */
  restoreExcludedCard: (binderId: string, copyId: string) => void;
  /** Switch a binder between rules and manual mode. */
  setBinderMode: (binderId: string, mode: 'rules' | 'manual') => void;
  /** Set the explicit card order. Pass undefined to revert to auto-sort. */
  setBinderManualOrder: (binderId: string, order: string[] | undefined) => void;
  /** Snapshot the current sorted order as the manual order. */
  seedManualOrder: (binderId: string, currentCardIds: string[]) => void;

  // Sub-collection actions
  createSubCollection: (name: string, color?: string) => string;
  renameSubCollection: (id: string, name: string) => void;
  recolorSubCollection: (id: string, color: string) => void;
  reorderSubCollections: (orderedIds: string[]) => void;
  deleteSubCollection: (id: string) => Promise<void>;
  moveCardsToSubCollection: (copyIds: string[], subCollectionId: string | null) => Promise<void>;

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
  deleteBinder: (id: string) => void;
  /** Removes every binder. Cards are unaffected — they fall back to Uncategorized. */
  deleteAllBinders: () => void;
  moveBinder: (id: string, direction: 'up' | 'down') => void;

  // UI actions
  setActiveTab: (tab: string) => void;
  setEditingBinder: (id: string | null) => void;
  setImportSheetOpen: (open: boolean) => void;

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
  subCollections: SubCollectionDef[];
}): StoredCollection {
  return {
    cards: s.cards,
    fileName: s.fileName,
    scryfallHits: s.scryfallHits,
    scryfallMisses: s.scryfallMisses,
    uploadedAt: s.uploadedAt ?? Date.now(),
    importHistory: s.importHistory,
    subCollections: s.subCollections,
  };
}

function remapDeckAllocations(newCards: EnrichedCard[]): void {
  const { decks, remapAllocations } = useDecksStore.getState();
  if (decks.length > 0) {
    remapAllocations(newCards);
  }
}

/**
 * Binder analogue of remapDeckAllocations: re-resolve every binder's pins /
 * exclusions from their durable natural-key shadow against the new collection.
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

export const useCollectionStore = create<CollectionState>()(
  persist(
    (set, get) => ({
      cards: [],
      fileName: '',
      scryfallHits: 0,
      scryfallMisses: 0,
      uploadedAt: null,
      unresolvedNames: [],
      detectedFormat: '',
      importHistory: [],
      hydrating: true,
      isLoading: false,
      isRefreshingPrices: false,
      error: null,
      activeTab: 'uncategorized',
      editingBinder: null,
      importSheetOpen: false,
      search: '',

      // Persisted defaults
      binders: [],
      subCollections: [],

      // Card actions
      hydrateCards: async () => {
        try {
          const stored = await loadCollection();
          if (stored) {
            // Back-fill history for collections saved before importHistory existed.
            const history: ImportHistoryEntry[] =
              stored.importHistory && stored.importHistory.length > 0
                ? stored.importHistory
                : stored.cards.length > 0
                  ? [
                      {
                        name: stored.fileName || 'previous import',
                        count: stored.cards.length,
                        format: '',
                        addedAt: stored.uploadedAt,
                      },
                    ]
                  : [];
            set({
              cards: stored.cards,
              fileName: stored.fileName,
              scryfallHits: stored.scryfallHits,
              scryfallMisses: stored.scryfallMisses,
              uploadedAt: stored.uploadedAt,
              importHistory: history,
              subCollections: stored.subCollections ?? [],
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to load saved collection';
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
        const baseStamped = response.cards.map((c) => ({ ...c, importId }));
        const stamped = options?.subCollectionId
          ? baseStamped.map((c) => assignSubCollection(c, options.subCollectionId!))
          : restoreSubCollectionAssignments(baseStamped, existing);
        const collectionMode = mode === 'binder' ? 'merge' : mode;
        const newCards = collectionMode === 'merge' ? mergeCards(existing, stamped) : stamped;
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

        remapDeckAllocations(newCards);
        // Re-resolve binder pins/exclusions from their durable key shadow. This
        // is the headline recovery path: re-uploading a CSV after a cache/sync
        // loss mints new copyIds, and this re-binds the user's pins to the
        // equivalent new copies instead of silently dropping them.
        remapBinderRefs(existing, newCards);

        try {
          await saveCollection(
            buildStored({
              cards: newCards,
              fileName,
              scryfallHits: response.scryfallHits,
              scryfallMisses: response.scryfallMisses,
              uploadedAt,
              importHistory,
              subCollections: get().subCollections,
            })
          );
        } catch (err) {
          console.warn('[store] Failed to persist collection:', err);
          set({
            error:
              'Cards imported but could not be saved locally. They will be lost if you refresh the page.',
          });
        }
      },

      deleteImports: async (ids) => {
        if (ids.length === 0) return;
        markDestructive();
        const idSet = new Set(ids);
        const s = get();
        const remainingCards = s.cards.filter((c) => !c.importId || !idSet.has(c.importId));
        const remainingHistory = s.importHistory.filter((h) => !h.id || !idSet.has(h.id));
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
                detectedFormat: '',
              }
            : {}),
        });
        if (remainingCards.length < s.cards.length) {
          remapDeckAllocations(remainingCards);
          remapBinderRefs(s.cards, remainingCards);
        }
        try {
          if (remainingCards.length === 0 && remainingHistory.length === 0) {
            await clearCollection();
          } else {
            await saveCollection({
              cards: remainingCards,
              fileName: remainingHistory.length === 0 ? '' : s.fileName,
              scryfallHits: s.scryfallHits,
              scryfallMisses: s.scryfallMisses,
              uploadedAt: s.uploadedAt ?? Date.now(),
              importHistory: remainingHistory,
            });
          }
        } catch (err) {
          console.warn('[store] Failed to persist after deleteImports:', err);
        }
      },

      updateCard: async (copyId, updates) => {
        const s = get();
        const updated = s.cards.map((c) =>
          c.copyId === copyId ? { ...c, ...updates, copyId } : c
        );
        set({ cards: updated });
        try {
          await saveCollection({
            cards: updated,
            fileName: s.fileName,
            scryfallHits: s.scryfallHits,
            scryfallMisses: s.scryfallMisses,
            uploadedAt: s.uploadedAt ?? Date.now(),
            importHistory: s.importHistory,
          });
        } catch (err) {
          console.warn('[store] Failed to persist card update:', err);
        }
      },

      replaceAllCards: async (cards) => {
        const s = get();
        const newCopyIds = new Set(cards.map((c) => c.copyId));
        const lostCopy = s.cards.some((c) => !newCopyIds.has(c.copyId));
        set({ cards });
        if (lostCopy) {
          remapDeckAllocations(cards);
          remapBinderRefs(s.cards, cards);
        }
        try {
          await saveCollection({
            cards,
            fileName: s.fileName,
            scryfallHits: s.scryfallHits,
            scryfallMisses: s.scryfallMisses,
            uploadedAt: s.uploadedAt ?? Date.now(),
            importHistory: s.importHistory,
          });
        } catch (err) {
          console.warn('[store] Failed to persist after replaceAllCards:', err);
        }
      },

      addCard: async (card, finish) => {
        const enriched = scryfallToEnrichedCard(card, finish);
        const s = get();
        const updated = [...s.cards, enriched];
        set({ cards: updated });
        try {
          await saveCollection({
            cards: updated,
            fileName: s.fileName,
            scryfallHits: s.scryfallHits,
            scryfallMisses: s.scryfallMisses,
            uploadedAt: s.uploadedAt ?? Date.now(),
            importHistory: s.importHistory,
          });
        } catch (err) {
          console.warn('[store] Failed to persist after addCard:', err);
        }
        return enriched.copyId;
      },

      refreshPrices: async (scryfallIds) => {
        const s = get();
        if (s.cards.length === 0) return;

        const ids =
          scryfallIds && scryfallIds.length > 0
            ? Array.from(new Set(scryfallIds.filter(Boolean)))
            : Array.from(new Set(s.cards.map((c) => c.scryfallId).filter(Boolean)));
        if (ids.length === 0) return;

        set({ isRefreshingPrices: true });
        try {
          const res = await fetch('/api/refresh-prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scryfallIds: ids }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error || `HTTP ${res.status}`);
          }
          const { prices } = (await res.json()) as {
            prices: Record<string, { usd: number; pricedAt: number }>;
          };

          // Stamp pricedAt on every requested card — even those Scryfall had no
          // price for. "We asked today, they had nothing" is a fresh result, so
          // those cards stop counting as stale and the banner can hide.
          const requested = new Set(ids);
          const stampedAt = Date.now();
          const updated = get().cards.map((c) => {
            const hit = prices[c.scryfallId];
            if (hit) return { ...c, purchasePrice: hit.usd, pricedAt: hit.pricedAt };
            if (requested.has(c.scryfallId)) return { ...c, pricedAt: stampedAt };
            return c;
          });

          set({ cards: updated });

          try {
            await saveCollection({
              cards: updated,
              fileName: get().fileName,
              scryfallHits: get().scryfallHits,
              scryfallMisses: get().scryfallMisses,
              uploadedAt: get().uploadedAt ?? Date.now(),
              importHistory: get().importHistory,
            });
          } catch (err) {
            console.warn('[store] Failed to persist refreshed prices:', err);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to refresh prices';
          console.warn('[store] refreshPrices failed:', err);
          set({ error: msg });
        } finally {
          set({ isRefreshingPrices: false });
        }
      },

      clearCards: async () => {
        markDestructive();
        const prevCards = get().cards;
        set({
          cards: [],
          fileName: '',
          scryfallHits: 0,
          scryfallMisses: 0,
          uploadedAt: null,
          unresolvedNames: [],
          detectedFormat: '',
          importHistory: [],
          error: null,
        });
        remapDeckAllocations([]);
        // Empties each binder's resolved pinnedCopyIds but RETAINS the durable
        // pinnedKeys, so re-importing the same collection restores the pins
        // rather than clearing them forever.
        remapBinderRefs(prevCards, []);
        try {
          await clearCollection();
        } catch (err) {
          console.warn('[store] Failed to clear cache:', err);
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
                subCollections: s.subCollections,
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
          detectedFormat: '',
          uploadedAt: collection ? uploadedAt : null,
          importHistory: restoredHistory,
          subCollections: collection?.subCollections ?? [],
          binders: backup.binders,
          activeTab: backup.binders[0]?.id ?? 'uncategorized',
          error: null,
        });

        remapDeckAllocations(collection?.cards ?? []);
        remapBinderRefs(prevCards, collection?.cards ?? []);

        if (collection) {
          try {
            await saveCollection({
              cards: collection.cards,
              fileName: collection.fileName,
              scryfallHits: collection.scryfallHits,
              scryfallMisses: collection.scryfallMisses,
              uploadedAt,
              importHistory: restoredHistory,
              subCollections: collection?.subCollections ?? [],
            });
          } catch (err) {
            console.warn('[store] Failed to persist restored collection:', err);
            set({
              error:
                'Backup restored to memory but could not be saved locally. It will be lost if you refresh the page.',
            });
          }
        } else {
          try {
            await clearCollection();
          } catch (err) {
            console.warn('[store] Failed to clear cache during restore:', err);
          }
        }
      },

      // Binder card customization actions
      pinCardToBinder: (binderId, copyId) => {
        let added = false;
        const cards = get().cards;
        const card = cards.find((c) => c.copyId === copyId);
        const byId = new Map(cards.map((c) => [c.copyId, c]));
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            const existing = b.pinnedCopyIds ?? [];
            if (existing.includes(copyId)) return b;
            added = true;
            const now = Date.now();
            const nextIds = [...existing, copyId];
            const updated = {
              ...b,
              pinnedCopyIds: nextIds,
              // Keep the durable key shadow in sync at pin time so a pin made
              // before the next collection change still survives a loss.
              pinnedKeys: keysForIds(nextIds, byId, existing, b.pinnedKeys ?? []),
              updatedAt: now,
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

      removeCardFromBinder: (binderId, copyId, isRuleMatched) => {
        const byId = new Map(get().cards.map((c) => [c.copyId, c]));
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            if (isRuleMatched) {
              const excluded = b.excludedCopyIds ?? [];
              if (excluded.includes(copyId)) return b;
              const nextExcluded = [...excluded, copyId];
              return {
                ...b,
                excludedCopyIds: nextExcluded,
                excludedKeys: keysForIds(nextExcluded, byId, excluded, b.excludedKeys ?? []),
                updatedAt: Date.now(),
              };
            } else {
              const nextPinned = (b.pinnedCopyIds ?? []).filter((id) => id !== copyId);
              return {
                ...b,
                pinnedCopyIds: nextPinned,
                pinnedKeys: keysForIds(nextPinned, byId, b.pinnedCopyIds ?? [], b.pinnedKeys ?? []),
                manualOrder: (b.manualOrder ?? []).filter((id) => id !== copyId),
                updatedAt: Date.now(),
              };
            }
          }),
        }));
      },

      restoreExcludedCard: (binderId, copyId) => {
        const byId = new Map(get().cards.map((c) => [c.copyId, c]));
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            const nextExcluded = (b.excludedCopyIds ?? []).filter((id) => id !== copyId);
            return {
              ...b,
              excludedCopyIds: nextExcluded,
              excludedKeys: keysForIds(
                nextExcluded,
                byId,
                b.excludedCopyIds ?? [],
                b.excludedKeys ?? []
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
        set((s) => ({
          binders: s.binders.map((b) =>
            b.id !== binderId ? b : { ...b, manualOrder: order ?? undefined, updatedAt: Date.now() }
          ),
        }));
      },

      seedManualOrder: (binderId, currentCardIds) => {
        set((s) => ({
          binders: s.binders.map((b) =>
            b.id !== binderId ? b : { ...b, manualOrder: currentCardIds, updatedAt: Date.now() }
          ),
        }));
      },

      // Sub-collection actions
      createSubCollection: (name, color) => {
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const defs = get().subCollections;
        const def: SubCollectionDef = {
          id,
          name: clampSubCollectionName(name) || 'Untitled',
          order: defs.length,
          ...(color ? { color } : {}),
        };
        set({ subCollections: [...defs, def] });
        void get().moveCardsToSubCollection([], id); // persist defs (no card change)
        return id;
      },

      renameSubCollection: (id, name) => {
        set({
          subCollections: get().subCollections.map((d) =>
            d.id === id ? { ...d, name: clampSubCollectionName(name) || d.name } : d
          ),
        });
        void get().moveCardsToSubCollection([], null);
      },

      recolorSubCollection: (id, color) => {
        set({
          subCollections: get().subCollections.map((d) => (d.id === id ? { ...d, color } : d)),
        });
        void get().moveCardsToSubCollection([], null);
      },

      reorderSubCollections: (orderedIds) => {
        const byId = new Map(get().subCollections.map((d) => [d.id, d]));
        const reordered = orderedIds
          .map((id, i) => {
            const d = byId.get(id);
            return d ? { ...d, order: i } : null;
          })
          .filter((d): d is SubCollectionDef => d !== null);
        set({ subCollections: reordered });
        void get().moveCardsToSubCollection([], null);
      },

      deleteSubCollection: async (id) => {
        const cards = get().cards.map((c) =>
          c.subCollectionId === id ? assignSubCollection(c, null) : c
        );
        const subCollections = get()
          .subCollections.filter((d) => d.id !== id)
          .map((d, i) => ({ ...d, order: i }));
        set({ cards, subCollections });
        remapDeckAllocations(cards);
        try {
          await saveCollection(buildStored({ ...get(), cards, subCollections }));
        } catch (err) {
          console.warn('[store] Failed to persist after deleteSubCollection:', err);
        }
      },

      moveCardsToSubCollection: async (copyIds, subCollectionId) => {
        const ids = new Set(copyIds);
        const cards =
          ids.size === 0
            ? get().cards
            : get().cards.map((c) =>
                ids.has(c.copyId) ? assignSubCollection(c, subCollectionId) : c
              );
        if (ids.size > 0) set({ cards });
        try {
          await saveCollection(buildStored({ ...get(), cards }));
        } catch (err) {
          console.warn('[store] Failed to persist after moveCardsToSubCollection:', err);
          set({
            error:
              'Sub-collection change saved in memory but could not be saved locally. It will be lost if you refresh the page.',
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
          binders: s.binders.map((b) =>
            b.id === id ? { ...b, ...input, id: b.id, updatedAt: Date.now() } : b
          ),
        }));
      },

      deleteBinder: (id) => {
        markDestructive();
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

      deleteAllBinders: () => {
        markDestructive();
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
      setEditingBinder: (id) => set({ editingBinder: id }),
      setImportSheetOpen: (open) => set({ importSheetOpen: open }),

      setSearch: (s) => set({ search: s }),
    }),
    {
      name: 'spellcontrol',
      version: 15,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        binders: s.binders,
      }),
      /**
       * v5 reworks the rule schema entirely (BinderRule[] → single BinderFilter with
       * IS/IS NOT chips, legalities, layouts, oracle text, etc). Older saved binders
       * use a shape we no longer understand, so we wipe them. Users start fresh.
       *
       * v6 introduces OR-groups: `filter` becomes `filterGroups`, an array of
       * `{ name?, filter }`. We wrap the existing single filter as a one-group
       * list so behavior is preserved exactly.
       *
       * v15 swaps every chip field on BinderFilter from `NegatableChip[]` to
       * `ChipExpression { chips, joiners }`. The new evaluator only handles
       * the new shape and would crash reading `.chips.length` on a legacy
       * array. We just drop binders — no UI for re-authoring lossy chip
       * sets in-place, and re-creating a rule is fast.
       */
      migrate: (persistedState, fromVersion) => {
        const state = persistedState as Record<string, unknown> | undefined;
        if (!state) return state as never;
        if (fromVersion < 5) {
          state.binders = [];
        }
        if (fromVersion < 6 && Array.isArray(state.binders)) {
          state.binders = (state.binders as Array<Record<string, unknown>>).map((b) => {
            const { filter, ...rest } = b;
            return {
              ...rest,
              filterGroups: [{ filter: filter ?? {} }],
            };
          });
        }
        // v7→v8: rename fixedPageCount (number of pages) → fixedCapacity (number
        // of cards). Capacity = old pageCount × the binder's effective pocket size.
        // Earlier v7 stores never shipped to users, but be defensive anyway.
        if (fromVersion < 8 && Array.isArray(state.binders)) {
          state.binders = (state.binders as Array<Record<string, unknown>>).map((b) => {
            const { fixedPageCount, ...rest } = b as {
              fixedPageCount?: number | null;
              fixedCapacity?: number | null;
              pocketSize?: number | null;
            } & Record<string, unknown>;
            const pocket = (rest.pocketSize as number | null) ?? 9;
            const carriedCapacity =
              typeof rest.fixedCapacity === 'number' ? rest.fixedCapacity : null;
            const derivedCapacity =
              typeof fixedPageCount === 'number' ? fixedPageCount * pocket : null;
            return {
              ...rest,
              fixedCapacity: carriedCapacity ?? derivedCapacity ?? null,
            };
          });
        }
        // v8→v9: split pocketSize into per-page pockets (4 | 9 | 12) plus a
        // separate `doubleSided` flag. Legacy 18 → {pocketSize 9, doubleSided},
        // 24 → {pocketSize 12, doubleSided}. "Page" now uniformly means one
        // side of a sheet, so totals and capacity divide cleanly by pocketSize.
        if (fromVersion < 10 && Array.isArray(state.binders)) {
          state.binders = (state.binders as Array<Record<string, unknown>>).map((b) => {
            const raw = b as { pocketSize?: number | null; doubleSided?: boolean } & Record<
              string,
              unknown
            >;
            const ps = raw.pocketSize;
            let pocketSize: number | null = ps ?? null;
            let doubleSided = !!raw.doubleSided;
            if (ps === 18) {
              pocketSize = 9;
              doubleSided = true;
            } else if (ps === 24) {
              pocketSize = 12;
              doubleSided = true;
            }
            return { ...raw, pocketSize, doubleSided };
          });
        }
        // v10→v11: sorts changed from SortField[] (string[]) to SortEntry[]
        // ({ field, dir }[]). Price defaults to desc; everything else to asc.
        if (fromVersion < 11 && Array.isArray(state.binders)) {
          state.binders = (state.binders as Array<Record<string, unknown>>).map((b) => ({
            ...b,
            sorts: normalizeSortEntries(b.sorts),
          }));
        }
        // v11→v12: added optional `mode` field to BinderDef. Undefined = 'rules'.
        // v12→v13: added optional `hideDeckAllocated` field. Undefined = include
        // deck-allocated cards (current behavior). No data transform needed.
        // v13→v14: split 'set' sort into 'setReleaseDate' (chronological) and
        // 'setName' (alphabetical). Existing 'set' entries map to
        // 'setReleaseDate' since that matches the post-fix behavior (sets sort
        // by Scryfall release date).
        if (fromVersion < 14 && Array.isArray(state.binders)) {
          state.binders = (state.binders as Array<Record<string, unknown>>).map((b) => {
            const sorts = b.sorts as Array<{ field: string; dir: string }> | undefined;
            if (!Array.isArray(sorts)) return b;
            return {
              ...b,
              sorts: sorts.map((s) => (s.field === 'set' ? { ...s, field: 'setReleaseDate' } : s)),
            };
          });
        }
        // v14→v15: every chip field on BinderFilter shifted from
        // `NegatableChip[]` to `ChipExpression { chips, joiners }`. Reading
        // `.chips.length` on a legacy array would crash the new evaluator,
        // and there's no faithful auto-conversion for mixed IS / IS NOT
        // chips. Wipe and have the user re-author — fast and lossless.
        if (fromVersion < 15) {
          state.binders = [];
        }
        return state as never;
      },
    }
  )
);
