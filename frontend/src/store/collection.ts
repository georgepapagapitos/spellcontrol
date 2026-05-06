import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { BinderDef, BinderInput, EnrichedCard, PocketSize, UploadResponse } from '../types';
import { saveCollection, loadCollection, clearCollection } from '../lib/local-cards';

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

  hydrating: boolean;
  isLoading: boolean;
  error: string | null;

  binders: BinderDef[];
  activeTab: string;
  editingBinder: string | null;

  globalPocketSize: PocketSize;
  search: string;

  // Card actions
  hydrateCards: () => Promise<void>;
  importCards: (response: UploadResponse, fileName: string, mode: ImportMode) => Promise<void>;
  clearCards: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (err: string | null) => void;

  // Binder actions
  createBinder: (input: BinderInput) => BinderDef;
  updateBinder: (id: string, input: Partial<BinderInput>) => void;
  deleteBinder: (id: string) => void;
  moveBinder: (id: string, direction: 'up' | 'down') => void;

  // UI actions
  setActiveTab: (tab: string) => void;
  setEditingBinder: (id: string | null) => void;

  // Config actions
  setGlobalPocketSize: (size: PocketSize) => void;
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
      hydrating: true,
      isLoading: false,
      error: null,
      activeTab: 'unbinned',
      editingBinder: null,
      search: '',

      // Persisted defaults
      binders: [],
      globalPocketSize: 9,

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
        const newCards = mode === 'merge' ? mergeCards(existing, response.cards) : response.cards;
        // For merge mode, we display the new file name but track lifetime hits/misses approximately.
        const displayName =
          mode === 'merge' && existing.length > 0 ? `${fileName} (merged)` : fileName;

        set({
          cards: newCards,
          fileName: displayName,
          scryfallHits: response.scryfallHits,
          scryfallMisses: response.scryfallMisses,
          unresolvedNames: response.unresolvedNames,
          detectedFormat: response.detectedFormat,
          uploadedAt,
          error: null,
        });

        try {
          await saveCollection({
            cards: newCards,
            fileName: displayName,
            scryfallHits: response.scryfallHits,
            scryfallMisses: response.scryfallMisses,
            uploadedAt,
          });
        } catch (err) {
          console.warn('[store] Failed to persist collection:', err);
          set({
            error: 'Cards imported but could not be saved locally. They will be lost if you refresh the page.',
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
          const newActive =
            s.activeTab === id ? remaining[0]?.id || 'unbinned' : s.activeTab;
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

      setGlobalPocketSize: (size) => set({ globalPocketSize: size }),
      setSearch: (s) => set({ search: s }),
    }),
    {
      name: 'mtg-binder-planner',
      version: 4,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        binders: s.binders,
        globalPocketSize: s.globalPocketSize,
      }),
      /**
       * Migrations:
       *   v2 → v3: single rule → rules array, stapleOnly → edhrecRankMax: 100
       *   v3 → v4: manaboxBinderContains → sourceCategoryContains; drop excludeDecks setting
       */
      migrate: (persistedState, fromVersion) => {
        const state = persistedState as Record<string, unknown> | undefined;
        if (!state) return state as never;

        if (fromVersion < 3 && Array.isArray(state.binders)) {
          state.binders = (state.binders as Record<string, unknown>[]).map((b) => {
            if ('rule' in b && !('rules' in b)) {
              const oldRule = b.rule as Record<string, unknown>;
              const newRule = { ...oldRule };
              if (newRule.stapleOnly === true) {
                delete newRule.stapleOnly;
                newRule.edhrecRankMax = 100;
              } else {
                delete newRule.stapleOnly;
              }
              b.rules = [newRule];
              delete b.rule;
            }
            return b;
          });
        }

        if (fromVersion < 4 && Array.isArray(state.binders)) {
          state.binders = (state.binders as Record<string, unknown>[]).map((b) => {
            const rules = b.rules as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(rules)) {
              b.rules = rules.map((r) => {
                if ('manaboxBinderContains' in r) {
                  r.sourceCategoryContains = r.manaboxBinderContains;
                  delete r.manaboxBinderContains;
                }
                return r;
              });
            }
            return b;
          });
          delete state.excludeDecks;
        }

        return state as never;
      },
    }
  )
);
