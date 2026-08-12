import { authedFetch, handleResponse } from './fetch-utils';
import type { GameAction, GameState } from './game-state';
import type { PublicBoard } from './playtest/projection';

/**
 * A cross-seat request/response — currently only `kind: 'rewind'` (see
 * `POST /api/games/:code/request` in backend `routes/games.ts`). Approvals
 * is a partial map: only seats that have responded appear in it. `status`
 * starts `pending` and is terminal once it's anything else — the server
 * deletes a resolved request from its store immediately, so a `pending`
 * request is the only kind still open for a response.
 */
export interface GameRequest {
  id: string;
  code: string;
  kind: 'rewind';
  payload: { steps: number; summary: string };
  requesterSeat: number;
  approvals: Record<number, boolean>;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
  createdAt: number;
  expiresAt: number;
}

export interface CreateGameInput {
  format: GameState['format'];
  startingLife: number;
  commanderDamageEnabled: boolean;
  poisonEnabled: boolean;
  hostName?: string;
  hostDeckId?: string | null;
  hostDeckName?: string | null;
  hostCommander?: string | null;
  hostPartner?: string | null;
  hostColorIdentity?: string[];
}

export async function createGame(input: CreateGameInput): Promise<GameState> {
  const res = await authedFetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await handleResponse<{ game: GameState }>(res);
  return data.game;
}

/**
 * Fetch a game's current state. When `knownVersion` is supplied the server may
 * answer `{ unchanged: true }` (the version still matches), in which case this
 * resolves to `null` so the caller can skip the update entirely — no full
 * `GameState` payload crosses the wire. Call without `knownVersion` to always
 * get the full state.
 */
export async function getGame(code: string, knownVersion?: number): Promise<GameState | null> {
  const path = `/api/games/${encodeURIComponent(code)}`;
  const url = knownVersion != null ? `${path}?knownVersion=${knownVersion}` : path;
  const res = await authedFetch(url);
  const data = await handleResponse<{ game?: GameState; unchanged?: boolean }>(res);
  return data.unchanged ? null : (data.game ?? null);
}

/** One published board, as delivered by `pollGame` / `subscribeGameEvents`. */
export interface BoardEntry {
  seat: number;
  board: unknown;
}

export interface PollResult {
  /** Fresh state, or null when the server reported `{ unchanged: true }`. */
  game: GameState | null;
  /** Full boards catch-up — present whenever `game` is (see the route doc). */
  boards?: BoardEntry[];
  /** A single board that resolved a held request early. */
  board?: BoardEntry;
  /** Pending cross-seat requests catch-up — present whenever `game` is. */
  requests?: GameRequest[];
  /** A single request create/respond/resolve that resolved a held poll early. */
  request?: GameRequest;
}

/**
 * One round-trip of `GET /api/games/:code/poll?since=<version>` (backend:
 * routes/games.ts) — the native long-poll transport's single request (the
 * loop built on top lives in lib/games-longpoll.ts). The server holds the
 * request open until either a mutation/board publish lands or ~25s elapses.
 *
 * `catchUp` forces an immediate reply (with the current `boards` snapshot)
 * even when `since` isn't stale — the long-poll loop passes it on its very
 * first request only, since a freshly-joined player's own `since` already
 * matches the version their join just produced (see the route doc for why
 * the ordinary staleness check alone would miss that case).
 */
export async function pollGame(
  code: string,
  since: number,
  signal?: AbortSignal,
  catchUp?: boolean
): Promise<PollResult> {
  const qs = `since=${since}${catchUp ? '&catchUp=1' : ''}`;
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}/poll?${qs}`, { signal });
  const data = await handleResponse<{
    game?: GameState;
    unchanged?: boolean;
    boards?: BoardEntry[];
    board?: BoardEntry;
    requests?: GameRequest[];
    request?: GameRequest;
  }>(res);
  return {
    game: data.unchanged ? null : (data.game ?? null),
    boards: data.boards,
    board: data.board,
    requests: data.requests,
    request: data.request,
  };
}

/**
 * Publish this seat's `PublicBoard` projection to the table (backend:
 * `POST /api/games/:code/board` in routes/games.ts). The server derives the
 * seat from the caller's own participant record — it ignores/overwrites
 * anything this payload claims — so this can never forge another seat's
 * board. Callers should go through the debounced wrapper in
 * `lib/games-board.ts` rather than calling this directly on every state
 * change.
 */
export async function postBoard(code: string, board: PublicBoard): Promise<void> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}/board`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(board),
  });
  await handleResponse<{ ok: boolean }>(res);
}

/**
 * Raise a cross-seat request (backend: `POST /api/games/:code/request`).
 * Today `kind: 'rewind'` is the only caller — the rewind classifier decides
 * *whether* a takeback needs consent; this is just the channel that carries
 * the ask to the table and back. The server derives the requesting seat
 * server-side and rejects a second raise while one is already pending for
 * that seat (409) — see the route's doc comment.
 */
export async function raiseGameRequest(
  code: string,
  kind: 'rewind',
  payload: { steps: number; summary: string }
): Promise<GameRequest> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, payload }),
  });
  const data = await handleResponse<{ request: GameRequest }>(res);
  return data.request;
}

/**
 * Approve or decline a pending request (backend:
 * `POST /api/games/:code/request/:id/respond`). The responding seat is
 * derived server-side; there's no seat to pass here. Returns the request's
 * new state — still `pending` if this response didn't resolve it (more
 * approvals still needed), or a terminal status otherwise.
 */
export async function respondGameRequest(
  code: string,
  id: string,
  approve: boolean
): Promise<GameRequest> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}/request/${id}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approve }),
  });
  const data = await handleResponse<{ request: GameRequest }>(res);
  return data.request;
}

/**
 * Withdraw a still-pending request (backend:
 * `POST /api/games/:code/request/:id/cancel`). Requester-only.
 */
export async function cancelGameRequest(code: string, id: string): Promise<GameRequest> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}/request/${id}/cancel`, {
    method: 'POST',
  });
  const data = await handleResponse<{ request: GameRequest }>(res);
  return data.request;
}

export interface JoinGameInput {
  name?: string;
  deckId?: string | null;
  deckName?: string | null;
  commander?: string | null;
  partner?: string | null;
  colorIdentity?: string[];
}

export async function joinGame(code: string, input: JoinGameInput): Promise<GameState> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await handleResponse<{ game: GameState }>(res);
  return data.game;
}

/**
 * Apply actions to a game. On a version conflict the server answers 409; we let
 * that (like any non-2xx) throw via `handleResponse` with `.status = 409` set,
 * so the caller's conflict-recovery branch (`dispatchOnline`) runs. Swallowing
 * the 409 into a returned snapshot silently desynced near-simultaneous plays.
 */
export async function patchGame(
  code: string,
  baseVersion: number,
  actions: GameAction[]
): Promise<{ game: GameState }> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseVersion, actions }),
  });
  const data = await handleResponse<{ game: GameState }>(res);
  return { game: data.game };
}

export async function leaveGame(code: string): Promise<{ deleted?: boolean; game?: GameState }> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}/leave`, {
    method: 'POST',
  });
  return handleResponse<{ deleted?: boolean; game?: GameState }>(res);
}
