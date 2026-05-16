import { get, set, del, createStore, type UseStore } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

/**
 * Zustand `StateStorage` backed by IndexedDB instead of localStorage.
 *
 * localStorage is capped at ~5 MB in WebKit/Safari, and a single deck embeds
 * the full Scryfall payload for every card. Importing several decks at once
 * pushes the serialized store past that cap and `setItem` throws
 * `QuotaExceededError: "The quota has been exceeded."`. IndexedDB has a far
 * larger quota and removes that ceiling.
 *
 * `getItem` migrates any existing localStorage value into IndexedDB on first
 * read, then clears the localStorage copy so prior decks are preserved and the
 * old quota is reclaimed.
 */
export function createIndexedDbStorage(dbName: string): StateStorage {
  // Non-browser environments (SSR, unit tests under the `node` runtime) have
  // no IndexedDB. Fall back to an in-memory map so store creation/hydration
  // never throws — same effective "no persistence" behaviour as before.
  if (typeof indexedDB === 'undefined') {
    const mem = new Map<string, string>();
    return {
      getItem: async (name) => mem.get(name) ?? null,
      setItem: async (name, value) => {
        mem.set(name, value);
      },
      removeItem: async (name) => {
        mem.delete(name);
      },
    };
  }

  let store: UseStore | null = null;
  const getStore = (): UseStore => {
    if (!store) store = createStore(dbName, 'keyval');
    return store;
  };

  return {
    getItem: async (name) => {
      const existing = await get<string>(name, getStore());
      if (existing != null) return existing;

      // One-time migration from the previous localStorage backing.
      try {
        const legacy = localStorage.getItem(name);
        if (legacy != null) {
          await set(name, legacy, getStore());
          localStorage.removeItem(name);
          return legacy;
        }
      } catch {
        // localStorage may be unavailable (private mode); nothing to migrate.
      }
      return null;
    },
    setItem: async (name, value) => {
      await set(name, value, getStore());
    },
    removeItem: async (name) => {
      await del(name, getStore());
    },
  };
}
