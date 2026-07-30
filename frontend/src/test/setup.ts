/**
 * Vitest global setup.
 *
 * The suite runs under `environment: 'node'` (fast, no DOM). A few stores
 * persist through zustand's `persist` middleware, which calls into
 * `localStorage` on every `setState`. Node has no `localStorage`, so we
 * install a tiny in-memory shim when one isn't already present. It is a
 * no-op in any DOM-backed environment (jsdom/happy-dom) and is inert for
 * tests that never touch storage.
 *
 * It also closes the structural hole behind E207 — see the fetch guard below.
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

/**
 * E207 — no test may reach the real network.
 *
 * Under `happy-dom` a relative `fetch('/api/…')` resolves against the default
 * document origin (`localhost:3000`) and is *genuinely attempted*, which is
 * where the CI signature `connect ECONNREFUSED 127.0.0.1:3000` came from. The
 * suite had no fetch guard at all, so every unstubbed call paid a real socket
 * round-trip whose rejection landed whenever it landed — sometimes after the
 * test file finished, i.e. during vitest worker teardown, which turns a fully
 * green suite into `EnvironmentTeardownError: Closing rpc while
 * "onUserConsoleLog" was pending` and exit 1.
 *
 * The guard rejects in a microtask instead: no socket, no unbounded latency,
 * and a message that names the fix rather than a bare ECONNREFUSED. Tests that
 * need fetch keep stubbing it — `setupFiles` run before the test module, so a
 * `vi.stubGlobal('fetch', …)` still wins, and `vi.unstubAllGlobals()` restores
 * to this guard rather than to a live socket.
 *
 * Measured, not reasoned: a full `test:coverage` run on the unguarded tree
 * emitted **405** `ECONNREFUSED ::1:3000` unhandled-rejection dumps; with the
 * guard it emits **0**, same 7437 passing tests. Those dumps were themselves
 * the late console writes losing the teardown race — the guard's rejection
 * lands inside each caller's own `catch` instead, which is why it also emits
 * zero of its own message.
 */
globalThis.fetch = ((input: RequestInfo | URL) =>
  Promise.reject(
    new Error(
      `[test] Unstubbed network call to ${String(input instanceof Request ? input.url : input)}. ` +
        `Tests must not hit the network — stub it with vi.stubGlobal('fetch', …) ` +
        `or mock the calling module.`
    )
  )) as typeof fetch;
