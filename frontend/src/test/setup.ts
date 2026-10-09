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

import { afterEach } from 'vitest';
// Registers pending()'s settle hook FIRST, so it runs LAST (afterEach hooks run
// in reverse registration order) — after React Testing Library has unmounted.
import './pending';

/**
 * E272 (slice 2) — let IndexedDB work settle before a test is torn down.
 *
 * fake-indexeddb completes every request on a `setImmediate` macrotask hop
 * (IndexedDB semantics need the transaction to go inactive between event-loop
 * turns), and the app's mount-time IDB reads (use-rarity-corrections'
 * manifest probe, sync.ts's queue-depth refresh, value-history snapshots)
 * outrun a synchronous RTL test by construction: the test ends, the chain is
 * still pending, and `--detectAsyncLeaks` reports ~100 promise leaks across
 * the DeckDisplay/DeckAnalysis families alone (measured 2026-09-09: 247
 * leaks, 224 of them promises, one source for ~100 of them). Draining a few
 * hops after each test lets those chains finish inside the test's own
 * lifetime — no per-file fake timers, no product change.
 *
 * `setImmediate` is captured here, before any test installs fake timers, so
 * a file that leaves `vi.useFakeTimers()` on can't turn this into a hang.
 */
const realSetImmediate = globalThis.setImmediate;
afterEach(async () => {
  // 8 hops covers open -> get/count -> close chains; raise if the
  // leak count climbs back.
  for (let i = 0; i < 8; i++) await new Promise<void>((r) => realSetImmediate(r));
});

/**
 * E272 (slice 3) — an unread `Response` body is a leaked promise.
 *
 * A fetch stub like `mockResolvedValue(new Response('nope', { status: 404 }))`
 * whose body the code under test never reads (every early-return error path)
 * leaves undici's body stream open, and `--detectAsyncLeaks` counts its pending
 * promise — 30 of the 110 leaks at the slice-3 baseline, across 17 client
 * tests. A null body, a consumed body or a canceled body all settle. Rather
 * than touching every stub, track each Response a test constructs and cancel
 * whatever it left unread once the test is over.
 */
const openResponses: Response[] = [];
const NativeResponse = globalThis.Response;
globalThis.Response = class extends NativeResponse {
  constructor(...args: ConstructorParameters<typeof NativeResponse>) {
    super(...args);
    openResponses.push(this);
  }
} as typeof Response;
afterEach(async () => {
  for (const res of openResponses.splice(0)) {
    if (res.body && !res.bodyUsed) await res.body.cancel().catch(() => {});
  }
});

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
/**
 * …except the LIVE_GEN eval harness, which is a deliberate live-network run —
 * it IS the deck-gen ship gate (`deckGenerator.live.test.ts` + the
 * `deckgen-eval-gate` skill), generating real decks off real EDHREC/Scryfall
 * data. That harness captures `globalThis.fetch` in its own `beforeAll` to use
 * as the pass-through for everything but two static fixtures; `setupFiles` run
 * first, so an unconditional guard here becomes the thing it captures and every
 * deck in the panel fails with "Couldn't reach Scryfall".
 *
 * That failure is invisible at the vitest level — the panel test still reports
 * green because it catches per-deck errors and writes a summary — so the gate
 * silently produced 0-deck panels whose "identical" comparison looked like a
 * pass. Gate on the env var rather than the guard, and leave the guard in force
 * for every ordinary run (LIVE_GEN unset).
 */
if (!process.env.LIVE_GEN) {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.reject(
      new Error(
        `[test] Unstubbed network call to ${String(input instanceof Request ? input.url : input)}. ` +
          `Tests must not hit the network — stub it with vi.stubGlobal('fetch', …) ` +
          `or mock the calling module.`
      )
    )) as typeof fetch;
}

// The first-party usage beacon (lib/util/analytics) fires on every route change.
// happy-dom's sendBeacon is a real window.fetch under the hood, which fails
// against the test origin and surfaces as an unhandled NetworkError per
// navigation; a no-op beacon keeps the suite quiet.
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'sendBeacon', { value: () => true, configurable: true });
}
