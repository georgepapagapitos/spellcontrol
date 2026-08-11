import { API_BASE_URL } from './api-base';
import { pollGame } from './games-api';
import type { GameState } from './game-state';

export interface GameLongPollHandlers {
  onState: (state: GameState) => void;
  /** Fired after every successful round-trip, whether or not it carried a new state — signals the transport is alive. */
  onHealthy?: () => void;
  onError?: () => void;
}

/**
 * True when this build must use long-poll instead of SSE for real-time game
 * updates — i.e. exactly the native (Capacitor) build.
 *
 * `EventSource` *exists* in the Capacitor WebView, so `typeof EventSource
 * === 'undefined'` is not a valid signal — SSE simply fails to *connect*
 * there: CapacitorHttp patches `fetch`/`XHR` to route around cross-origin
 * cookie restrictions, but it does not patch `EventSource`, so an SSE
 * request from the WebView is a genuine cross-origin browser request with no
 * CORS headers on this backend (see games-sse.ts) and never connects.
 * `API_BASE_URL` (api-base.ts) is non-empty exactly when the build targets a
 * cross-origin backend — i.e. exactly the native build — so it's the real
 * signal to key off, not a UA sniff.
 */
export function usesLongPoll(apiBaseUrl: string = API_BASE_URL): boolean {
  return apiBaseUrl !== '';
}

/**
 * Long-poll transport for `GET /api/games/:code/poll?since=<version>`
 * (backend: routes/games.ts) — the native replacement for SSE (see
 * `usesLongPoll`). Loops a held request indefinitely: each response either
 * carries a fresh state (forwarded to `onState`) or `{ unchanged: true }`
 * after the server's ~25s hold timeout, and either way the loop immediately
 * re-issues with `getSince()`'s latest value — `getSince` is a getter
 * (not a snapshot) so the loop always polls with the caller's current known
 * version. A failed round-trip calls `onError` and stops the loop; the
 * caller decides whether/when to retry (store/play.ts backs off and falls
 * back to the 2.5s poll in the meantime).
 *
 * Returns a teardown function, matching `subscribeGameEvents`'s shape so
 * store/play.ts can treat both transports uniformly.
 */
export function subscribeGameLongPoll(
  code: string,
  getSince: () => number,
  handlers: GameLongPollHandlers
): () => void {
  let stopped = false;
  const controller = new AbortController();

  void (async function loop() {
    while (!stopped) {
      try {
        const state = await pollGame(code, getSince(), controller.signal);
        if (stopped) return;
        handlers.onHealthy?.();
        if (state) handlers.onState(state);
      } catch {
        if (stopped) return;
        handlers.onError?.();
        return;
      }
    }
  })();

  return () => {
    stopped = true;
    controller.abort();
  };
}
