import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { BinderDef, BinderInput, EnrichedCard, UploadResponse } from '../types';
import {
  saveCollection,
  loadCollection,
  clearCollection,
  type ImportHistoryEntry,
  type StoredCollection,
} from '../lib/local-cards';
import { buildBackup, normalizeSortEntries, type Backup } from '../lib/backup';
import { SAMPLE_BINDERS, SAMPLE_IMPORT_LABEL } from '../lib/samples';

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
  activeTab: string;
  editingBinder: string | null;
  /** Whether the mobile binder picker sheet is open. Driven by the bottom
   * nav's Binders icon while on the /binder route. */
  binderPickerOpen: boolean;
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
    options?: { isSample?: boolean; binderName?: string }
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
  /** Set the explicit card order. Pass undefined to revert to auto-sort. */
  setBinderManualOrder: (binderId: string, order: string[] | undefined) => void;
  /** Snapshot the current sorted order as the manual order. */
  seedManualOrder: (binderId: string, currentCardIds: string[]) => void;

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
  setBinderPickerOpen: (open: boolean) => void;
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
      binderPickerOpen: false,
      importSheetOpen: false,
      search: '',

      // Persisted defaults
      binders: [],

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
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to load saved collection';
          set({ error: msg });
        } finally {
          set({ hydrating: false });
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
            color: '#6366f1',
            pinnedCopyIds: copyIds,
            manualOrder: copyIds,
            createdAt: now,
            updatedAt: now,
          };
          stateUpdate.binders = [...get().binders, binder];
          stateUpdate.activeTab = binder.id;
        }

        set(stateUpdate);

        try {
          await saveCollection({
            cards: newCards,
            fileName,
            scryfallHits: response.scryfallHits,
            scryfallMisses: response.scryfallMisses,
            uploadedAt,
            importHistory,
          });
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
        set({ cards });
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
              }
            : null;
        return buildBackup(collection, s.binders);
      },

      restoreFromBackup: async (backup) => {
        const collection = backup.collection;
        const uploadedAt = collection?.uploadedAt ?? Date.now();
        const restoredHistory: ImportHistoryEntry[] = collection?.importHistory ?? [];

        set({
          cards: collection?.cards ?? [],
          fileName: collection?.fileName ?? '',
          scryfallHits: collection?.scryfallHits ?? 0,
          scryfallMisses: collection?.scryfallMisses ?? 0,
          unresolvedNames: [],
          detectedFormat: '',
          uploadedAt: collection ? uploadedAt : null,
          importHistory: restoredHistory,
          binders: backup.binders,
          activeTab: backup.binders[0]?.id ?? 'uncategorized',
          error: null,
        });

        if (collection) {
          try {
            await saveCollection({
              cards: collection.cards,
              fileName: collection.fileName,
              scryfallHits: collection.scryfallHits,
              scryfallMisses: collection.scryfallMisses,
              uploadedAt,
              importHistory: restoredHistory,
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
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            const existing = b.pinnedCopyIds ?? [];
            if (existing.includes(copyId)) return b;
            added = true;
            return { ...b, pinnedCopyIds: [...existing, copyId], updatedAt: Date.now() };
          }),
        }));
        return added;
      },

      removeCardFromBinder: (binderId, copyId, isRuleMatched) => {
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            if (isRuleMatched) {
              const excluded = b.excludedCopyIds ?? [];
              if (excluded.includes(copyId)) return b;
              return { ...b, excludedCopyIds: [...excluded, copyId], updatedAt: Date.now() };
            } else {
              return {
                ...b,
                pinnedCopyIds: (b.pinnedCopyIds ?? []).filter((id) => id !== copyId),
                manualOrder: (b.manualOrder ?? []).filter((id) => id !== copyId),
                updatedAt: Date.now(),
              };
            }
          }),
        }));
      },

      restoreExcludedCard: (binderId, copyId) => {
        set((s) => ({
          binders: s.binders.map((b) => {
            if (b.id !== binderId) return b;
            return {
              ...b,
              excludedCopyIds: (b.excludedCopyIds ?? []).filter((id) => id !== copyId),
              updatedAt: Date.now(),
            };
          }),
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
        set((s) => {
          const remaining = s.binders
            .filter((b) => b.id !== id)
            .sort((a, b) => a.position - b.position)
            .map((b, i) => ({ ...b, position: i }));
          const newActive = s.activeTab === id ? remaining[0]?.id || 'uncategorized' : s.activeTab;
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
          const renumbered = sorted.map((b, i) => ({ ...b, position: i }));
          return { binders: renumbered };
        });
      },

      setActiveTab: (tab) => set({ activeTab: tab }),
      setEditingBinder: (id) => set({ editingBinder: id }),
      setBinderPickerOpen: (open) => set({ binderPickerOpen: open }),
      setImportSheetOpen: (open) => set({ importSheetOpen: open }),

      setSearch: (s) => set({ search: s }),
    }),
    {
      name: 'mtg-binder-planner',
      version: 11,
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
        return state as never;
      },
    }
  )
);
