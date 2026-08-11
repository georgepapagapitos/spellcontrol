import { apiUrl } from './api-base';
import type { GameState } from './game-state';
import type { PublicBoard } from './playtest/projection';

export interface GameEventHandlers {
  onState: (state: GameState) => void;
  /** A published board — either a catch-up frame sent right after connect, or a live update. */
  onBoard?: (seat: number, board: PublicBoard) => void;
  onOpen?: () => void;
  onError?: () => void;
}

/**
 * Subscribes to `GET /api/games/:code/events` (backend: routes/games.ts).
 * The server pushes the current state once on connect and again on every
 * mutation; a version check happens on the caller's side (see
 * store/play.ts's `applyServerGameState`), not here.
 *
 * `withCredentials: true` is required for the native app's cross-origin
 * build (VITE_API_BASE_URL set — see api-base.ts) to even attempt sending
 * the session cookie; on same-origin web deploys it's a no-op. Native's
 * CapacitorHttp plugin only patches `fetch`/`XHR`, not `EventSource`, so
 * this stream is a genuine cross-origin browser request there — with no
 * CORS headers configured on the backend (matching the existing pattern:
 * none of this app's other routes send Access-Control-Allow-Origin either),
 * it will fail to connect and `onError` fires immediately. That's fine: the
 * caller's poll fallback (which native's fetch patch lets through cross-
 * origin without issue) keeps the game usable there exactly as before this
 * feature shipped.
 *
 * Returns a teardown function — call it once the subscriber no longer cares
 * (leave, unmount, switching games).
 */
export function subscribeGameEvents(code: string, handlers: GameEventHandlers): () => void {
  const es = new EventSource(apiUrl(`/api/games/${encodeURIComponent(code)}/events`), {
    withCredentials: true,
  });
  es.addEventListener('open', () => handlers.onOpen?.());
  es.addEventListener('error', () => handlers.onError?.());
  es.addEventListener('state', (ev: MessageEvent<string>) => {
    try {
      handlers.onState(JSON.parse(ev.data) as GameState);
    } catch {
      // Malformed frame — ignore; the next state push or the poll fallback
      // will catch up.
    }
  });
  es.addEventListener('board', (ev: MessageEvent<string>) => {
    try {
      const { seat, board } = JSON.parse(ev.data) as { seat: number; board: PublicBoard };
      handlers.onBoard?.(seat, board);
    } catch {
      // Malformed frame — ignore; the next publish will catch up.
    }
  });
  return () => es.close();
}
