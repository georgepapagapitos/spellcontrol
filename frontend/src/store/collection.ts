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
import { buildBackup, type Backup } from '../lib/backup';

function newBinderId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `bndr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export type ImportMode = 'replace' | 'merge';

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
  error: string | null;

  binders: BinderDef[];
  activeTab: string;
  editingBinder: string | null;

  search: string;

  // Card actions
  hydrateCards: () => Promise<void>;
  importCards: (response: UploadResponse, fileName: string, mode: ImportMode) => Promise<void>;
  clearCards: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (err: string | null) => void;

  // Backup actions
  buildBackupSnapshot: () => Backup;
  restoreFromBackup: (backup: Backup) => Promise<void>;

  // Binder actions
  createBinder: (input: BinderInput) => BinderDef;
  updateBinder: (id: string, input: Partial<BinderInput>) => void;
  deleteBinder: (id: string) => void;
  moveBinder: (id: string, direction: 'up' | 'down') => void;

  // UI actions
  setActiveTab: (tab: string) => void;
  setEditingBinder: (id: string | null) => void;

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
      error: null,
      activeTab: 'uncategorized',
      editingBinder: null,
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

      importCards: async (response, fileName, mode) => {
        const uploadedAt = Date.now();
        const existing = get().cards;
        const existingHistory = get().importHistory;
        const newCards = mode === 'merge' ? mergeCards(existing, response.cards) : response.cards;
        const entry: ImportHistoryEntry = {
          name: fileName,
          count: response.cards.length,
          format: response.detectedFormat,
          addedAt: uploadedAt,
        };
        const importHistory =
          mode === 'merge' && existing.length > 0 ? [...existingHistory, entry] : [entry];

        set({
          cards: newCards,
          fileName,
          scryfallHits: response.scryfallHits,
          scryfallMisses: response.scryfallMisses,
          unresolvedNames: response.unresolvedNames,
          detectedFormat: response.detectedFormat,
          uploadedAt,
          importHistory,
          error: null,
        });

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

      // Binder actions
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

      setSearch: (s) => set({ search: s }),
    }),
    {
      name: 'mtg-binder-planner',
      version: 5,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        binders: s.binders,
      }),
      /**
       * v5 reworks the rule schema entirely (BinderRule[] → single BinderFilter with
       * IS/IS NOT chips, legalities, layouts, oracle text, etc). Older saved binders
       * use a shape we no longer understand, so we wipe them. Users start fresh.
       */
      migrate: (persistedState, fromVersion) => {
        const state = persistedState as Record<string, unknown> | undefined;
        if (!state) return state as never;
        if (fromVersion < 5) {
          state.binders = [];
        }
        return state as never;
      },
    }
  )
);
