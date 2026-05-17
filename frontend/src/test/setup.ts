/**
 * Vitest global setup.
 *
 * The suite runs under `environment: 'node'` (fast, no DOM). A few stores
 * persist through zustand's `persist` middleware, which calls into
 * `localStorage` on every `setState`. Node has no `localStorage`, so we
 * install a tiny in-memory shim when one isn't already present. It is a
 * no-op in any DOM-backed environment (jsdom/happy-dom) and is inert for
 * tests that never touch storage.
 */

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}
